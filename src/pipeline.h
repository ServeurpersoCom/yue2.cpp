#pragma once
// pipeline.h: YuE2 generation pipeline
//
// Holds the two GGUF of a release resident and turns one request into audio:
// a symbolic plan, a semantic token stream, the acoustic flow matching solved
// from the AR prefix cache, and the VAE decode to 48 kHz stereo.
//
// The NAR reads the KV cache the AR pass already filled, so its own prefill
// never runs: one forward of the end token completes the sequence it attends
// to.

#include "bpe.h"
#include "generate.h"
#include "nar.h"
#include "request.h"
#include "torch-cpu-rng.h"
#include "vae.h"

#include <cstdlib>
#include <string>
#include <vector>

#define YUE2_SAMPLE_RATE 48000
#define YUE2_FRAME_RATE  25
#define YUE2_LATENT_DIM  64
#define YUE2_HOP         1920

// VRAM and compatibility knobs. The AR and NAR halves share one KV cache by
// construction, so there is no eviction group to trade here: max_seq is the
// memory lever, it sizes the cache that dominates the residency.
struct Yue2PipelineParams {
    int  max_seq    = 0;      // 0 = model context, the whole 24576
    bool no_fa      = false;  // disable flash attention
    bool clamp_fp16 = false;  // clamp hidden states on sub-Ampere CUDA
    int  vae_core   = 1024;   // VAE tile core frames
    int  vae_halo   = 16;     // VAE tile halo frames
};

struct Yue2Pipeline {
    BPETokenizer       tok;
    Qwen3LM            lm;
    Yue2NAR            nar;
    VAEGGML            vae;
    Yue2PipelineParams params;
    bool               loaded = false;
};

struct Yue2Song {
    std::string        score;      // ABC of the plan, empty in off mode
    std::vector<int>   tokens;     // semantic stream, codec values
    std::vector<float> latents;    // acoustic latents, [T_lat, 64] time major
    std::vector<float> audio;      // planar stereo, [2, T_audio]
    int                T_audio;    // samples per channel
    int                T_lat;      // semantic frames
    bool               truncated;  // a stage hit its budget before its end token
};

// Parses the CSV interchange of a semantic stream
static bool pipeline_parse_tokens(const std::string & csv, std::vector<int> * out) {
    out->clear();
    const char * p = csv.c_str();
    while (*p) {
        while (*p == ',' || *p == ' ' || *p == '\n' || *p == '\r' || *p == '\t') {
            p++;
        }
        if (!*p) {
            break;
        }
        char * end   = nullptr;
        long   value = strtol(p, &end, 10);
        if (end == p || value < 0 || value >= YUE2_CODEC_SIZE) {
            fprintf(stderr, "[Pipeline] FATAL: semantic token outside [0, %d)\n", YUE2_CODEC_SIZE);
            return false;
        }
        out->push_back((int) value);
        p = end;
    }
    return !out->empty();
}

static bool pipeline_load(Yue2Pipeline *             p,
                          const char *               model_path,
                          const char *               vae_path,
                          const Yue2PipelineParams & params) {
    if (!load_bpe_from_gguf(&p->tok, model_path)) {
        return false;
    }
    // One cache set: the guided path grows it on demand, and guidance is the
    // exception, not the nominal mode
    if (!qw3lm_load(&p->lm, model_path, params.max_seq, 1)) {
        return false;
    }
    // Both halves read these, the NAR bakes them into its graph at build time
    p->lm.use_flash_attn = p->lm.use_flash_attn && !params.no_fa;
    p->lm.clamp_fp16     = params.clamp_fp16;
    p->params            = params;
    p->nar               = {};
    if (!nar_load(&p->nar, &p->lm, model_path)) {
        qw3lm_free(&p->lm);
        return false;
    }
    p->vae = {};
    vae_ggml_load(&p->vae, vae_path);
    p->loaded = true;
    return true;
}

static void pipeline_free(Yue2Pipeline * p) {
    if (!p->loaded) {
        return;
    }
    vae_ggml_free(&p->vae);
    nar_free(&p->nar);
    qw3lm_free(&p->lm);
    p->loaded = false;
}

static bool pipeline_cot(const std::string & name, Yue2Cot * cot) {
    for (const Yue2CotMode & m : YUE2_COT_MODES) {
        if (name == m.name) {
            *cot = m.mode;
            return true;
        }
    }
    return false;
}

static bool pipeline_generate(Yue2Pipeline *      p,
                              const Yue2Request & r,
                              Yue2Song *          song,
                              bool (*cancelled)(void *) = nullptr,
                              void * cancel_data        = nullptr) {
    Yue2Cot cot;
    if (!pipeline_cot(r.cot, &cot)) {
        fprintf(stderr, "[Pipeline] FATAL: cot must be full, melody or off\n");
        return false;
    }
    if (r.steps < 1) {
        fprintf(stderr, "[Pipeline] FATAL: steps must be positive\n");
        return false;
    }
    if (!yue2_sampling_valid(r.abc_sampling, "abc") || !yue2_sampling_valid(r.semantic_sampling, "semantic")) {
        return false;
    }

    BPETokenizer * tok    = &p->tok;
    auto           encode = [tok](const std::string & text) {
        return bpe_encode(tok, text);
    };

    song->score.clear();
    song->truncated = false;

    // Score: supplied by the caller, planned by the model, or absent
    std::vector<int> abc_ids;
    bool             has_score = cot != YUE2_COT_OFF;
    if (has_score) {
        if (!r.abc.empty()) {
            abc_ids     = encode(r.abc);
            song->score = r.abc;
        } else {
            std::vector<int> open = yue2_build_prompt_ids(encode, cot, r.style, r.lyrics, nullptr);
            Yue2Generation   plan;
            if (!yue2_generate(&p->lm, open, {}, 1.0f, r.abc_sampling, r.lm_seed, YUE2_PHASE_ABC, &plan, cancelled,
                               cancel_data)) {
                return false;
            }
            abc_ids         = plan.tokens;
            song->score     = bpe_decode(tok, abc_ids);
            song->truncated = plan.truncated;
            fprintf(stderr, "[Pipeline] Score: %zu tokens%s\n", abc_ids.size(), plan.truncated ? " (truncated)" : "");
        }
    }

    std::vector<int> prefix = yue2_build_prompt_ids(encode, cot, r.style, r.lyrics, has_score ? &abc_ids : nullptr);

    float            guidance = r.cfg_scale < 0.0f ? yue2_default_guidance(cot) : r.cfg_scale;
    std::vector<int> negative;
    if (guidance != 1.0f) {
        negative = yue2_build_negative_ids(encode, cot, has_score ? &abc_ids : nullptr);
    }

    Yue2Generation codes;
    bool           replay = !r.semantic_tokens.empty();
    if (replay) {
        std::vector<int> values;
        if (!pipeline_parse_tokens(r.semantic_tokens, &values)) {
            return false;
        }
        codes.tokens.reserve(values.size());
        for (size_t i = 0; i < values.size(); i++) {
            codes.tokens.push_back(values[i] + YUE2_CODEC_OFFSET);
        }
        codes.truncated = false;
        fprintf(stderr, "[Pipeline] Replay: %zu frames supplied\n", codes.tokens.size());
    } else {
        // The requested length caps the budget of the stage, never raises it
        Yue2Sampling semantic = r.semantic_sampling;
        int          budget   = (int) (r.duration * (float) YUE2_FRAME_RATE);
        if (budget > 0 && budget < semantic.max_tokens) {
            semantic.max_tokens = budget;
            if (semantic.min_tokens > semantic.max_tokens) {
                semantic.min_tokens = semantic.max_tokens;
            }
        }
        if (!yue2_generate(&p->lm, prefix, negative, guidance, semantic, r.lm_seed, YUE2_PHASE_SEMANTIC, &codes,
                           cancelled, cancel_data)) {
            return false;
        }
    }
    song->T_lat = (int) codes.tokens.size();
    if (song->T_lat < 1) {
        fprintf(stderr, "[Pipeline] FATAL: empty semantic stream\n");
        return false;
    }
    song->truncated = song->truncated || codes.truncated;
    fprintf(stderr, "[Pipeline] Semantic: %d frames%s, %.1f s\n", song->T_lat, codes.truncated ? " (truncated)" : "",
            (float) song->T_lat / (float) YUE2_FRAME_RATE);

    song->tokens.clear();
    song->tokens.reserve(codes.tokens.size());
    for (size_t i = 0; i < codes.tokens.size(); i++) {
        song->tokens.push_back(codes.tokens[i] - YUE2_CODEC_OFFSET);
    }

    // The noise of the whole song is drawn once, each chunk taking its view
    song->latents.assign((size_t) song->T_lat * YUE2_LATENT_DIM, 0.0f);
    torch_cpu_randn((uint64_t) r.seed, song->latents.data(), (int64_t) song->latents.size());

    // Acoustic chunks: the context holds the prefix, the codes of the chunk
    // and their latent block twice over, once as tokens and once as frames
    const int context    = p->lm.cfg.max_seq_len;
    const int prefix_len = (int) prefix.size();
    const int chunk_size = (context - prefix_len - 3) / 2;
    if (chunk_size < 1) {
        fprintf(stderr, "[Pipeline] FATAL: prefix %d leaves no acoustic context in %d\n", prefix_len, context);
        return false;
    }

    // The forwards below only fill the cache, their logits go nowhere
    std::vector<float> probe((size_t) p->lm.cfg.vocab_size);
    for (int start = 0; start < song->T_lat; start += chunk_size) {
        int frames = song->T_lat - start < chunk_size ? song->T_lat - start : chunk_size;
        int ar_len = prefix_len + frames + 1;

        // One chunk of a generated song already sits in the cache: the end
        // token completes it. Anything else prefills the chunk sequence.
        if (!replay && start == 0 && frames == song->T_lat) {
            int end = YUE2_MUSIC_END;
            qw3lm_forward(&p->lm, &end, 1, 0, probe.data());
        } else {
            std::vector<int> sequence = prefix;
            sequence.insert(sequence.end(), codes.tokens.begin() + start, codes.tokens.begin() + start + frames);
            sequence.push_back(YUE2_MUSIC_END);
            qw3lm_reset_kv(&p->lm, 0);
            qw3lm_forward(&p->lm, sequence.data(), (int) sequence.size(), 0, probe.data());
        }

        if (!nar_solve(&p->nar, song->latents.data() + (size_t) start * YUE2_LATENT_DIM, frames, ar_len, r.steps,
                       cancelled, cancel_data)) {
            return false;
        }
    }

    int max_T_audio = song->T_lat * YUE2_HOP;
    song->audio.assign((size_t) 2 * max_T_audio, 0.0f);
    song->T_audio = vae_ggml_decode_tiled(&p->vae, song->latents.data(), song->T_lat, song->audio.data(), max_T_audio,
                                          p->params.vae_core, p->params.vae_halo, cancelled, cancel_data);
    if (song->T_audio < 0) {
        return false;
    }
    song->audio.resize((size_t) 2 * song->T_audio);
    return true;
}
