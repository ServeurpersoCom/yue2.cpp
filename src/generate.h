// generate.h: the two autoregressive stages
//
// One stage prefills its prefix into KV set 0 and decodes until the model
// emits its end token or the budget runs out. The draw is conformant with the
// reference at equal seed, and both stages restart the generator at the
// request seed, which the release does on purpose.
#pragma once

#include "qwen3-lm.h"
#include "sampling.h"
#include "timer.h"

#include <cstdio>
#include <cstring>
#include <vector>

struct Yue2Generation {
    std::vector<int> tokens;     // emitted content, end token excluded
    bool             truncated;  // the budget ran out before the end token
};

// Guidance of exactly one keeps a single branch, which is the nominal path in
// melody and full mode. Anything else prefills the unconditional prefix into
// KV set 1 and decodes both branches in one batched forward, the conditional
// and unconditional logits combining before the distribution.
static bool yue2_generate(Qwen3LM *                lm,
                          const std::vector<int> & prefix,
                          const std::vector<int> & negative,
                          float                    cfg_scale,
                          const Yue2Sampling &     s,
                          int64_t                  seed,
                          Yue2Phase                phase,
                          Yue2Generation *         out,
                          bool (*cancelled)(void *) = nullptr,
                          void * cancel_data        = nullptr) {
    bool guided = cfg_scale != 1.0f;
    if ((int) prefix.size() + s.max_tokens > YUE2_CONTEXT) {
        fprintf(stderr, "[Gen] FATAL: prefix %zu + budget %d exceeds context %d\n", prefix.size(), s.max_tokens,
                YUE2_CONTEXT);
        return false;
    }
    if (guided && negative.empty()) {
        fprintf(stderr, "[Gen] FATAL: guidance %.3f needs an unconditional prefix\n", (double) cfg_scale);
        return false;
    }
    if (guided && (int) negative.size() + s.max_tokens > YUE2_CONTEXT) {
        fprintf(stderr, "[Gen] FATAL: unconditional prefix %zu + budget %d exceeds context %d\n", negative.size(),
                s.max_tokens, YUE2_CONTEXT);
        return false;
    }
    if (guided) {
        qw3lm_kv_sets(lm, 2);
    }

    int          V     = lm->cfg.vocab_size;
    int          end   = phase == YUE2_PHASE_ABC ? YUE2_ABC_END : YUE2_MUSIC_END;
    const char * label = phase == YUE2_PHASE_ABC ? "Score" : "Semantic";
    Timer        timer;

    Timer prefill_timer;
    qw3lm_reset_kv(lm, 0);
    std::vector<float> cond((size_t) V);
    qw3lm_forward(lm, prefix.data(), (int) prefix.size(), 0, cond.data());

    std::vector<float> uncond;
    std::vector<float> batched;
    if (guided) {
        qw3lm_reset_kv(lm, 1);
        uncond.resize((size_t) V);
        batched.resize((size_t) 2 * V);
        qw3lm_forward(lm, negative.data(), (int) negative.size(), 1, uncond.data());
    }
    fprintf(stderr, "[Gen] %s prefill: %.0f ms, %zu tokens, CFG=%.2f, top_k=%d, budget=%d\n", label, prefill_timer.ms(),
            prefix.size(), (double) cfg_scale, s.top_k, s.max_tokens);

    out->tokens.clear();
    out->truncated = true;

    std::vector<float>         mixed(guided ? (size_t) V : 0);
    std::vector<Yue2Candidate> candidates;
    for (int step = 0; step < s.max_tokens; step++) {
        if (cancelled && cancelled(cancel_data)) {
            fprintf(stderr, "[Gen] Cancelled at step %d\n", step);
            return false;
        }
        const float * logits = cond.data();
        if (guided) {
            for (int i = 0; i < V; i++) {
                mixed[(size_t) i] = uncond[(size_t) i] + cfg_scale * (cond[(size_t) i] - uncond[(size_t) i]);
            }
            logits = mixed.data();
        }
        yue2_distribution(logits, s, out->tokens, step, phase, candidates);
        int token = yue2_draw(candidates, seed, step);
        if (token == end) {
            out->truncated = false;
            fprintf(stderr, "[Gen] %s: end token at step %d\n", label, step);
            break;
        }
        out->tokens.push_back(token);
        if ((step % 100) == 0) {
            fprintf(stderr, "[Gen] %s %d/%d\n", label, step, s.max_tokens);
        }
        if (step + 1 >= s.max_tokens) {
            continue;
        }
        if (guided) {
            int tokens[2]  = { token, token };
            int kv_sets[2] = { 0, 1 };
            qw3lm_forward_batch(lm, tokens, kv_sets, 2, batched.data());
            memcpy(cond.data(), batched.data(), (size_t) V * sizeof(float));
            memcpy(uncond.data(), batched.data() + V, (size_t) V * sizeof(float));
        } else {
            qw3lm_forward(lm, &token, 1, 0, cond.data());
        }
    }

    int n = (int) out->tokens.size();
    fprintf(stderr, "[Gen] %s: %d tokens%s, %.1f s (%.1f ms/token)\n", label, n, out->truncated ? " (truncated)" : "",
            timer.ms() / 1000.0, n > 0 ? timer.ms() / n : 0.0);
    return true;
}
