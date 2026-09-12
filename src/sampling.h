// sampling.h: request local sampling of the two AR stages
//
// The protocol restricts each stage to its own slice of the vocabulary, bans
// its end token until a floor of emitted tokens, penalizes the ids of a
// sliding window by their frequency, then truncates by top-k and nucleus.
// The surviving candidates carry the scores the final softmax runs on, so a
// caller only has to normalize them and draw.
#pragma once

#include "philox.h"
#include "prompt.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

// Which AR stage the logits come from
enum Yue2Phase {
    YUE2_PHASE_ABC,       // symbolic plan, ordinary text vocabulary
    YUE2_PHASE_SEMANTIC,  // codec tokens
};

struct Yue2Sampling {
    float temperature;
    float top_p;
    int   top_k;
    float repetition_penalty;
    int   penalty_window;
    int   min_tokens;
    int   max_tokens;
};

// The bounds the protocol enforces on an overridden preset
static bool yue2_sampling_valid(const Yue2Sampling & s, const char * stage) {
    bool ok = s.temperature >= 0.0f && s.temperature <= 5.0f && s.top_p > 0.0f && s.top_p <= 1.0f && s.top_k >= 1 &&
              s.repetition_penalty > 0.0f && s.penalty_window >= 1 && s.penalty_window <= 100 && s.min_tokens >= 0 &&
              s.min_tokens <= s.max_tokens && s.max_tokens >= 1;
    if (!ok) {
        fprintf(stderr, "[Sampling] FATAL: %s preset outside the protocol bounds\n", stage);
    }
    return ok;
}

// Checkpoint native defaults (YuE2-3B/yue2_generation_config.json)
static const Yue2Sampling YUE2_ABC_SAMPLING      = { 0.7f, 0.9f, 30, 1.005f, 100, 32, 4096 };
static const Yue2Sampling YUE2_SEMANTIC_SAMPLING = { 1.0f, 0.95f, 100, 1.2f, 50, 200, 9000 };

struct Yue2Candidate {
    int   id;
    float score;
};

// Allowed id range of a stage, end token excluded
static void yue2_phase_range(Yue2Phase phase, int * lo, int * hi, int * end) {
    if (phase == YUE2_PHASE_ABC) {
        *lo  = 0;
        *hi  = YUE2_EOD;
        *end = YUE2_ABC_END;
        return;
    }
    *lo  = YUE2_CODEC_OFFSET;
    *hi  = YUE2_CODEC_OFFSET + YUE2_CODEC_SIZE;
    *end = YUE2_MUSIC_END;
}

// Frequency of one id in the penalty window
static int yue2_window_count(const std::vector<int> & history, int window, int id) {
    size_t first = history.size() > (size_t) window ? history.size() - (size_t) window : 0;
    int    count = 0;
    for (size_t i = first; i < history.size(); i++) {
        if (history[i] == id) {
            count++;
        }
    }
    return count;
}

// Score of one candidate: the window penalty scales negatives and divides
// positives, then temperature rescales.
static float yue2_score(float logit, const std::vector<int> & history, const Yue2Sampling & s, int id) {
    float score = logit;
    if (s.repetition_penalty != 1.0f) {
        int freq = yue2_window_count(history, s.penalty_window, id);
        if (freq > 0) {
            float alpha = powf(s.repetition_penalty, (float) freq);
            score       = score < 0.0f ? score * alpha : score / alpha;
        }
    }
    if (s.temperature != 0.0f && s.temperature != 1.0f) {
        score /= s.temperature;
    }
    return score;
}

// Candidates that survive the phase mask, the end token floor, top-k and the
// nucleus, in descending score order. Temperature zero returns the argmax alone.
static void yue2_distribution(const float *                logits,
                              const Yue2Sampling &         s,
                              const std::vector<int> &     history,
                              int                          step,
                              Yue2Phase                    phase,
                              std::vector<Yue2Candidate> & out) {
    int lo, hi, end;
    yue2_phase_range(phase, &lo, &hi, &end);

    out.clear();
    out.reserve((size_t) (hi - lo) + 1);
    for (int id = lo; id < hi; id++) {
        out.push_back({ id, yue2_score(logits[id], history, s, id) });
    }
    if (step >= s.min_tokens) {
        out.push_back({ end, yue2_score(logits[end], history, s, end) });
    }

    if (s.temperature == 0.0f) {
        size_t best = 0;
        for (size_t i = 1; i < out.size(); i++) {
            if (out[i].score > out[best].score) {
                best = i;
            }
        }
        Yue2Candidate winner = out[best];
        out.assign(1, winner);
        return;
    }

    // top-k keeps every candidate at or above the k-th score, ties included
    int k = s.top_k < (int) out.size() ? s.top_k : (int) out.size();
    std::partial_sort(out.begin(), out.begin() + k, out.end(),
                      [](const Yue2Candidate & a, const Yue2Candidate & b) { return a.score > b.score; });
    float  threshold = out[k - 1].score;
    size_t kept      = 0;
    for (size_t i = 0; i < out.size(); i++) {
        if (out[i].score >= threshold) {
            out[kept++] = out[i];
        }
    }
    out.resize(kept);
    std::sort(out.begin(), out.end(),
              [](const Yue2Candidate & a, const Yue2Candidate & b) { return a.score > b.score; });

    if (s.top_p >= 1.0f) {
        return;
    }

    // Nucleus over the surviving distribution, the best candidate always stays
    float  top = out[0].score;
    double sum = 0;
    for (size_t i = 0; i < out.size(); i++) {
        sum += exp((double) (out[i].score - top));
    }
    double cumulative = 0;
    for (size_t i = 0; i < out.size(); i++) {
        if (i > 0 && cumulative > (double) s.top_p) {
            out.resize(i);
            break;
        }
        cumulative += exp((double) (out[i].score - top)) / sum;
    }
}

// cuRAND float conversion of one Philox word, on (0, 1]
static float yue2_curand_uniform(uint32_t x) {
    return (float) x * CURAND_2POW32_INV + (CURAND_2POW32_INV * 0.5f);
}

// One token draw, conformant with torch.multinomial(p, 1) at equal seed.
// Without replacement torch takes argmax(p / Exp(1)), and every vocabulary
// entry draws its exponential from its own Philox subsequence, so only the
// nucleus is drawn. The draw index is the generator offset of the stage,
// which advances by one counter per token.
static int yue2_draw(const std::vector<Yue2Candidate> & candidates, int64_t seed, int64_t draw_index) {
    float  top = candidates[0].score;
    double sum = 0;
    for (size_t i = 0; i < candidates.size(); i++) {
        sum += exp((double) (candidates[i].score - top));
    }

    uint32_t seed_lo = (uint32_t) seed;
    uint32_t seed_hi = (uint32_t) ((uint64_t) seed >> 32);
    int      best    = candidates[0].id;
    float    ratio   = -1.0f;
    for (size_t i = 0; i < candidates.size(); i++) {
        Philox4 ctr = {
            (uint32_t) draw_index,
            (uint32_t) ((uint64_t) draw_index >> 32),
            (uint32_t) candidates[i].id,
            0,
        };
        Philox4 r = philox4x32_10(ctr, seed_lo, seed_hi);
        float   p = (float) (exp((double) (candidates[i].score - top)) / sum);
        float   e = -logf(yue2_curand_uniform(r.x));
        float   c = p / e;
        if (c > ratio) {
            ratio = c;
            best  = candidates[i].id;
        }
    }
    return best;
}

// Dense probability vector the draw runs on, zero outside the nucleus
static void yue2_probabilities(const std::vector<Yue2Candidate> & candidates,
                               int                                vocab_size,
                               std::vector<float> &               probs) {
    probs.assign((size_t) vocab_size, 0.0f);
    if (candidates.empty()) {
        return;
    }
    float  top = candidates[0].score;
    double sum = 0;
    for (size_t i = 0; i < candidates.size(); i++) {
        sum += exp((double) (candidates[i].score - top));
    }
    for (size_t i = 0; i < candidates.size(); i++) {
        probs[(size_t) candidates[i].id] = (float) (exp((double) (candidates[i].score - top)) / sum);
    }
}
