#pragma once
// pipeline.h: YuE2 generation pipeline
//
// Holds the two GGUF of a release resident and turns one request into
// tracks: a symbolic plan, a semantic token stream, the acoustic flow
// matching solved from the AR prefix cache, and the VAE decode to 48 kHz
// stereo, for every song of the batch and every noise variation of a song.
//
// The NAR reads the KV cache the AR decode left complete, end token
// included, so a generated song that fits one chunk never prefills.

#include "bpe.h"
#include "generate.h"
#include "nar.h"
#include "request.h"
#include "timer.h"
#include "torch-cpu-rng.h"
#include "vae.h"

#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#define YUE2_SAMPLE_RATE 48000
#define YUE2_FRAME_RATE  25
#define YUE2_LATENT_DIM  64
#define YUE2_HOP         1920

// VRAM and compatibility knobs. The AR and NAR halves share one KV cache by
// construction, so there is no eviction group to trade here: max_seq and
// max_batch are the memory levers, they size the cache that dominates the
// residency.
struct Yue2PipelineParams {
    int  max_seq    = 0;              // 0 = model context, the whole 24576
    int  max_batch  = 1;              // song batch limit, one KV set per song, two under guidance
    bool no_fa      = false;          // disable flash attention
    bool clamp_fp16 = false;          // clamp hidden states on sub-Ampere CUDA
    int  vae_core   = 1024;           // VAE tile core frames
    int  vae_halo   = 16;             // VAE tile halo frames

    const char * dump_dir = nullptr;  // probe dumps of the first track for the cossim harness
};

struct Yue2Pipeline {
    BPETokenizer       tok;
    Qwen3LM            lm;
    Yue2NAR            nar;
    VAEGGML            vae;
    Yue2PipelineParams params;
    DebugDumper        dumper;
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

// Writes the CSV interchange of a semantic stream
static std::string pipeline_format_tokens(const std::vector<int> & tokens) {
    std::string csv;
    for (size_t i = 0; i < tokens.size(); i++) {
        csv += (i ? "," : "") + std::to_string(tokens[i]);
    }
    return csv;
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
    debug_init(&p->dumper, params.dump_dir);
    if (!p->lm.use_flash_attn) {
        fprintf(stderr, "[Pipeline] Flash attention disabled\n");
    }
    if (p->lm.clamp_fp16) {
        fprintf(stderr, "[Pipeline] FP16 clamp enabled\n");
    }
    p->nar = {};
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

// Renders lm_batch_size songs times synth_batch_size variations, song-major:
// track song * M + variation. Song i draws its tokens with lm_seed + i in
// KV set i, variation j draws its noise with seed + j, and the M variations
// of a song solve in one NAR graph over the set the AR left complete.
static bool pipeline_generate(Yue2Pipeline *          p,
                              const Yue2Request &     r,
                              std::vector<Yue2Song> * songs,
                              bool (*cancelled)(void *) = nullptr,
                              void * cancel_data        = nullptr) {
    Timer   total_timer;
    Yue2Cot cot;
    if (!pipeline_cot(r.cot, &cot)) {
        fprintf(stderr, "[Pipeline] FATAL: cot must be full, melody or off\n");
        return false;
    }
    if (r.steps < 1 || r.lm_batch_size < 1 || r.synth_batch_size < 1) {
        fprintf(stderr, "[Pipeline] FATAL: steps and batch sizes must be positive\n");
        return false;
    }
    if (!yue2_sampling_valid(r.abc_sampling, "abc") || !yue2_sampling_valid(r.semantic_sampling, "semantic")) {
        return false;
    }

    BPETokenizer * tok    = &p->tok;
    auto           encode = [tok](const std::string & text) {
        return bpe_encode(tok, text);
    };

    // A supplied stream is one song, the batch counter has nothing to draw
    bool replay = !r.semantic_tokens.empty();
    if (replay && r.lm_batch_size > 1) {
        fprintf(stderr, "[Pipeline] Replay: lm_batch_size ignored\n");
    }
    const int B = replay ? 1 : r.lm_batch_size;
    const int M = r.synth_batch_size;

    // Score per song: supplied by the caller, planned by the model, or absent
    std::vector<std::vector<int>> abc_ids(B);
    std::vector<std::string>      scores(B);
    std::vector<bool>             truncated(B, false);
    bool                          has_score = cot != YUE2_COT_OFF;
    if (has_score && !r.abc.empty()) {
        abc_ids.assign(B, encode(r.abc));
        scores.assign(B, r.abc);
    } else if (has_score) {
        std::vector<int>            open = yue2_build_prompt_ids(encode, cot, r.style, r.lyrics, nullptr);
        std::vector<Yue2Generation> plans;
        if (!yue2_generate(&p->lm, std::vector<std::vector<int>>(B, open), {}, 1.0f, r.abc_sampling, r.lm_seed,
                           YUE2_PHASE_ABC, &plans, cancelled, cancel_data)) {
            return false;
        }
        for (int i = 0; i < B; i++) {
            abc_ids[i]   = plans[i].tokens;
            scores[i]    = bpe_decode(tok, abc_ids[i]);
            truncated[i] = plans[i].truncated;
        }
    }

    std::vector<std::vector<int>> prefixes(B);
    for (int i = 0; i < B; i++) {
        prefixes[i] = yue2_build_prompt_ids(encode, cot, r.style, r.lyrics, has_score ? &abc_ids[i] : nullptr);
    }
    fprintf(stderr, "[Prompt] cot=%s, songs=%d, variations=%d, %zu tracks\n", r.cot.c_str(), B, M, (size_t) B * M);

    float                         guidance = r.cfg_scale < 0.0f ? yue2_default_guidance(cot) : r.cfg_scale;
    std::vector<std::vector<int>> negatives;
    if (guidance != 1.0f) {
        negatives.resize(B);
        for (int i = 0; i < B; i++) {
            negatives[i] = yue2_build_negative_ids(encode, cot, has_score ? &abc_ids[i] : nullptr);
        }
    }

    std::vector<Yue2Generation> codes(B);
    if (replay) {
        std::vector<int> values;
        if (!pipeline_parse_tokens(r.semantic_tokens, &values)) {
            return false;
        }
        codes[0].tokens.reserve(values.size());
        for (size_t i = 0; i < values.size(); i++) {
            codes[0].tokens.push_back(values[i] + YUE2_CODEC_OFFSET);
        }
        codes[0].truncated = false;
        fprintf(stderr, "[Pipeline] Replay: %zu frames supplied\n", codes[0].tokens.size());
    } else {
        // The requested length caps the budget of the stage, never raises it
        Yue2Sampling semantic = r.semantic_sampling;
        int          budget   = (int) (r.duration * (float) YUE2_FRAME_RATE);
        if (budget > 0 && budget < semantic.max_tokens) {
            fprintf(stderr, "[AR] Frame budget clamped to %d by the requested duration (%.1f s)\n", budget,
                    (double) r.duration);
            semantic.max_tokens = budget;
            if (semantic.min_tokens > semantic.max_tokens) {
                semantic.min_tokens = semantic.max_tokens;
            }
        }
        if (!yue2_generate(&p->lm, prefixes, negatives, guidance, semantic, r.lm_seed, YUE2_PHASE_SEMANTIC, &codes,
                           cancelled, cancel_data)) {
            return false;
        }
    }

    songs->assign((size_t) B * M, {});
    for (int i = 0; i < B; i++) {
        int T_lat = (int) codes[i].tokens.size();
        if (T_lat < 1) {
            fprintf(stderr, "[Pipeline] FATAL: empty semantic stream\n");
            return false;
        }
        for (int j = 0; j < M; j++) {
            Yue2Song & song = (*songs)[(size_t) i * M + j];
            song.score      = scores[i];
            song.T_lat      = T_lat;
            song.truncated  = truncated[i] || codes[i].truncated;
            song.tokens.reserve(codes[i].tokens.size());
            for (size_t k = 0; k < codes[i].tokens.size(); k++) {
                song.tokens.push_back(codes[i].tokens[k] - YUE2_CODEC_OFFSET);
            }
            // The noise of a variation is drawn once for the whole song, each
            // chunk taking its view
            song.latents.assign((size_t) T_lat * YUE2_LATENT_DIM, 0.0f);
            torch_cpu_randn((uint64_t) (r.seed + j), song.latents.data(), (int64_t) song.latents.size());
        }
    }

    // Acoustic chunks: the context holds the prefix, the codes of the chunk
    // and their latent block twice over, once as tokens and once as frames
    // The chunk prefill logits go nowhere, the semantic window keeps the
    // graph key of the stage
    const int context = p->lm.cfg.max_seq_len;
    int       row0, rows;
    yue2_phase_rows(YUE2_PHASE_SEMANTIC, &row0, &rows);
    std::vector<float> probe((size_t) rows);
    std::vector<float> block;
    DebugDumper        quiet;
    debug_init(&quiet, nullptr);
    for (int i = 0; i < B; i++) {
        const int prefix_len = (int) prefixes[i].size();
        const int chunk_size = (context - prefix_len - 3) / 2;
        const int T_lat      = (int) codes[i].tokens.size();
        if (chunk_size < 1) {
            fprintf(stderr, "[Pipeline] FATAL: prefix %d leaves no acoustic context in %d\n", prefix_len, context);
            return false;
        }
        int chunks = (T_lat + chunk_size - 1) / chunk_size;
        fprintf(stderr, "[NAR] Song %d: %d frames (%.1f s), prefix %d, %d chunk%s of %d, %d variation%s\n", i, T_lat,
                (float) T_lat / (float) YUE2_FRAME_RATE, prefix_len, chunks, chunks > 1 ? "s" : "", chunk_size, M,
                M > 1 ? "s" : "");
        for (int start = 0; start < T_lat; start += chunk_size) {
            Timer chunk_timer;
            int   frames = T_lat - start < chunk_size ? T_lat - start : chunk_size;
            int   ar_len = prefix_len + frames + 1;

            // A generated song sits complete in its set when it fits one
            // chunk. Anything else prefills the chunk sequence, whose logits
            // go nowhere.
            std::vector<int> sequence = prefixes[i];
            sequence.insert(sequence.end(), codes[i].tokens.begin() + start, codes[i].tokens.begin() + start + frames);
            sequence.push_back(YUE2_MUSIC_END);
            if (replay || frames != T_lat) {
                qw3lm_reset_kv(&p->lm, i);
                qw3lm_forward(&p->lm, sequence.data(), (int) sequence.size(), i, probe.data(), row0, rows);
            }

            // The first chunk of the first song feeds the cossim harness: the
            // sequence the latent block attends to, then the solver probes
            const DebugDumper * dbg = i == 0 && start == 0 ? &p->dumper : &quiet;
            if (dbg->enabled) {
                std::vector<float> ids(sequence.begin(), sequence.end());
                debug_dump_1d(dbg, "ar_ids", ids.data(), (int) ids.size());
            }

            // The M variations of the chunk solve side by side
            size_t span = (size_t) frames * YUE2_LATENT_DIM;
            block.resize(span * M);
            for (int j = 0; j < M; j++) {
                memcpy(block.data() + span * j,
                       (*songs)[(size_t) i * M + j].latents.data() + (size_t) start * YUE2_LATENT_DIM,
                       span * sizeof(float));
            }
            if (!nar_solve(&p->nar, block.data(), frames, M, ar_len, i, r.steps, dbg, cancelled, cancel_data)) {
                return false;
            }
            for (int j = 0; j < M; j++) {
                memcpy((*songs)[(size_t) i * M + j].latents.data() + (size_t) start * YUE2_LATENT_DIM,
                       block.data() + span * j, span * sizeof(float));
            }
            fprintf(stderr, "[NAR] Song %d chunk %d/%d: %d frames, cache %d rows, %.1f s\n", i, start / chunk_size + 1,
                    chunks, frames, ar_len, chunk_timer.ms() / 1000.0);
        }
    }

    for (size_t t = 0; t < songs->size(); t++) {
        Yue2Song & song        = (*songs)[t];
        int        max_T_audio = song.T_lat * YUE2_HOP;
        fprintf(stderr, "[VAE] Track %zu/%zu: song %zu variation %zu\n", t + 1, songs->size(), t / M, t % M);
        song.audio.assign((size_t) 2 * max_T_audio, 0.0f);
        song.T_audio = vae_ggml_decode_tiled(&p->vae, song.latents.data(), song.T_lat, song.audio.data(), max_T_audio,
                                             p->params.vae_core, p->params.vae_halo, cancelled, cancel_data);
        if (song.T_audio < 0) {
            return false;
        }
        song.audio.resize((size_t) 2 * song.T_audio);
        if (t == 0 && p->dumper.enabled) {
            // Interleaved [T_audio, 2] like the torch reference dump
            std::vector<float> interleaved((size_t) 2 * song.T_audio);
            for (int k = 0; k < song.T_audio; k++) {
                interleaved[(size_t) 2 * k]     = song.audio[(size_t) k];
                interleaved[(size_t) 2 * k + 1] = song.audio[(size_t) song.T_audio + k];
            }
            debug_dump_2d(&p->dumper, "vae_audio", interleaved.data(), song.T_audio, 2);
        }
    }

    float seconds = 0.0f;
    for (size_t t = 0; t < songs->size(); t++) {
        seconds += (float) (*songs)[t].T_audio / (float) YUE2_SAMPLE_RATE;
    }
    fprintf(stderr, "[Pipeline] Done: %zu tracks, %.1f s of audio in %.1f s (%.1fx realtime)\n", songs->size(), seconds,
            total_timer.ms() / 1000.0, seconds / (float) (total_timer.ms() / 1000.0));
    return true;
}
