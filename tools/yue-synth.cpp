// yue-synth.cpp: full pipeline CLI, style and lyrics to stereo audio
//
// Plans a score, writes the semantic token stream, solves the acoustic flow
// matching from the AR prefix cache, and decodes the latents to 48 kHz stereo.

#include "audio-io.h"
#include "pipeline.h"
#include "version.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

static void print_usage(const char * prog) {
    fprintf(stderr, "yue2.cpp %s\n\n", YUE2_VERSION);
    fprintf(stderr,
            "Usage: %s --model <gguf> --vae <gguf> --request <json> [options]\n"
            "       %s --model <gguf> --vae <gguf> --style <file> --lyrics <file> [options]\n"
            "\n"
            "Required:\n"
            "  --model <gguf>         Backbone GGUF\n"
            "  --vae <gguf>           VAE GGUF\n"
            "  --request <json>       Input request JSON\n"
            "\n"
            "Optional:\n"
            "  --style <file>         Style tags (instead of --request)\n"
            "  --lyrics <file>        Lyrics (instead of --request)\n"
            "  --abc <file>           Score to realize instead of planning one\n"
            "  --out <path>           Output audio (default: song.mp3)\n"
            "  --score <path>         Also write the planned score\n"
            "  --tokens <path>        Also write the semantic stream (CSV)\n"
            "  --latent <path>        Also write the acoustic latents (.vae)\n"
            "  --cot <mode>           full, melody or off (default: full)\n"
            "  --duration <s>         Target length in seconds (default: 360)\n"
            "  --lm-seed <N>          Token sampling seed (default: random)\n"
            "  --seed <N>             Acoustic noise seed (default: random)\n"
            "  --steps <N>            Flow matching steps (default: 32)\n"
            "  --cfg-scale <f>        Guidance on the semantic stage (default: protocol)\n"
            "  --format <fmt>         mp3, wav16, wav24 or wav32 (default: mp3)\n"
            "  --peak-clip <N>        Normalization percentile control (default: 10)\n"
            "  --bitrate <kbps>       MP3 bitrate (default: 128)\n"
            "\n"
            "Debug:\n"
            "  --max-seq <N>          KV cache size (default: model context)\n"
            "  --max-tokens <N>       Semantic budget (default: 9000)\n"
            "  --temp <f>             Semantic temperature (default: 1.0)\n"
            "  --top-p <f>            Semantic nucleus (default: 0.95)\n"
            "  --top-k <N>            Semantic top-k (default: 100)\n"
            "  --rep-penalty <f>      Semantic repetition penalty (default: 1.2)\n"
            "  --penalty-window <N>   Semantic penalty window (default: 50)\n"
            "  --min-tokens <N>       Semantic floor before the end token (default: 200)\n"
            "  --vae-core <N>         VAE tile core frames (default: 1024)\n"
            "  --vae-halo <N>         VAE tile halo frames (default: 16)\n"
            "  --no-fa                Disable flash attention\n"
            "  --clamp-fp16           Clamp hidden states to FP16 range\n"
            "  --help                 Show this help\n",
            prog, prog);
}

static bool read_file(const char * path, std::string * out) {
    FILE * f = fopen(path, "rb");
    if (!f) {
        fprintf(stderr, "[Synth] FATAL: cannot read %s\n", path);
        return false;
    }
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    out->resize(size > 0 ? (size_t) size : 0);
    size_t got = out->empty() ? 0 : fread(&(*out)[0], 1, out->size(), f);
    fclose(f);
    if (got != out->size()) {
        fprintf(stderr, "[Synth] FATAL: cannot read %s\n", path);
        return false;
    }
    return true;
}

int main(int argc, char ** argv) {
    if (argc < 2) {
        print_usage(argv[0]);
        return 1;
    }

    const char *       model_path  = nullptr;
    const char *       vae_path    = nullptr;
    const char *       style_path  = nullptr;
    const char *       lyrics_path = nullptr;
    const char *       abc_path    = nullptr;
    const char *       score_path  = nullptr;
    const char *       tokens_path = nullptr;
    const char *       latent_path = nullptr;
    const char *       out_path    = nullptr;
    Yue2PipelineParams params;

    Yue2Request r;
    request_init(&r);
    for (int i = 1; i + 1 < argc; i++) {
        if (!strcmp(argv[i], "--request") && !request_parse(&r, argv[i + 1])) {
            return 1;
        }
    }

    for (int i = 1; i < argc; i++) {
        bool last = i + 1 >= argc;
        if (!strcmp(argv[i], "--model") && !last) {
            model_path = argv[++i];
        } else if (!strcmp(argv[i], "--vae") && !last) {
            vae_path = argv[++i];
        } else if (!strcmp(argv[i], "--request") && !last) {
            i++;  // parsed before the flag pass so the flags override it
        } else if (!strcmp(argv[i], "--style") && !last) {
            style_path = argv[++i];
        } else if (!strcmp(argv[i], "--lyrics") && !last) {
            lyrics_path = argv[++i];
        } else if (!strcmp(argv[i], "--abc") && !last) {
            abc_path = argv[++i];
        } else if (!strcmp(argv[i], "--score") && !last) {
            score_path = argv[++i];
        } else if (!strcmp(argv[i], "--tokens") && !last) {
            tokens_path = argv[++i];
        } else if (!strcmp(argv[i], "--latent") && !last) {
            latent_path = argv[++i];
        } else if (!strcmp(argv[i], "--out") && !last) {
            out_path = argv[++i];
        } else if (!strcmp(argv[i], "--cot") && !last) {
            r.cot = argv[++i];
        } else if (!strcmp(argv[i], "--duration") && !last) {
            r.duration = (float) atof(argv[++i]);
        } else if (!strcmp(argv[i], "--lm-seed") && !last) {
            r.lm_seed = atoll(argv[++i]);
        } else if (!strcmp(argv[i], "--seed") && !last) {
            r.seed = atoll(argv[++i]);
        } else if (!strcmp(argv[i], "--steps") && !last) {
            r.steps = atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--cfg-scale") && !last) {
            r.cfg_scale = (float) atof(argv[++i]);
        } else if (!strcmp(argv[i], "--format") && !last) {
            r.output_format = argv[++i];
        } else if (!strcmp(argv[i], "--peak-clip") && !last) {
            r.peak_clip = atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--bitrate") && !last) {
            r.mp3_bitrate = atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--max-seq") && !last) {
            params.max_seq = atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--vae-core") && !last) {
            params.vae_core = atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--vae-halo") && !last) {
            params.vae_halo = atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--no-fa")) {
            params.no_fa = true;
        } else if (!strcmp(argv[i], "--clamp-fp16")) {
            params.clamp_fp16 = true;
        } else if (!strcmp(argv[i], "--help")) {
            print_usage(argv[0]);
            return 0;
        } else if (!strcmp(argv[i], "--max-tokens") && !last) {
            r.semantic_sampling.max_tokens = atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--temp") && !last) {
            r.semantic_sampling.temperature = (float) atof(argv[++i]);
        } else if (!strcmp(argv[i], "--top-p") && !last) {
            r.semantic_sampling.top_p = (float) atof(argv[++i]);
        } else if (!strcmp(argv[i], "--top-k") && !last) {
            r.semantic_sampling.top_k = atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--rep-penalty") && !last) {
            r.semantic_sampling.repetition_penalty = (float) atof(argv[++i]);
        } else if (!strcmp(argv[i], "--penalty-window") && !last) {
            r.semantic_sampling.penalty_window = atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--min-tokens") && !last) {
            r.semantic_sampling.min_tokens = atoi(argv[++i]);
        } else {
            fprintf(stderr, "[Synth] FATAL: unknown argument %s\n", argv[i]);
            return 1;
        }
    }

    if (!model_path || !vae_path) {
        fprintf(stderr, "[Synth] ERROR: --model and --vae are required\n\n");
        print_usage(argv[0]);
        return 1;
    }

    if (style_path && !read_file(style_path, &r.style)) {
        return 1;
    }
    if (lyrics_path && !read_file(lyrics_path, &r.lyrics)) {
        return 1;
    }
    if (abc_path && !read_file(abc_path, &r.abc)) {
        return 1;
    }
    if (r.style.empty() && r.lyrics.empty()) {
        fprintf(stderr, "[Synth] ERROR: --request or --style and --lyrics are required\n\n");
        print_usage(argv[0]);
        return 1;
    }
    request_resolve_seed(&r);

    bool      is_mp3  = false;
    WavFormat wav_fmt = WAV_S16;
    if (!audio_parse_format(r.output_format.c_str(), is_mp3, wav_fmt)) {
        fprintf(stderr, "[Synth] FATAL: unknown output format %s\n", r.output_format.c_str());
        return 1;
    }
    std::string target = out_path ? out_path : ("song." + std::string(is_mp3 ? "mp3" : "wav"));

    Yue2Pipeline pipeline;
    if (!pipeline_load(&pipeline, model_path, vae_path, params)) {
        return 1;
    }

    Yue2Song song;
    if (!pipeline_generate(&pipeline, r, &song)) {
        pipeline_free(&pipeline);
        return 1;
    }
    pipeline_free(&pipeline);

    if (tokens_path) {
        std::string csv;
        for (size_t i = 0; i < song.tokens.size(); i++) {
            csv += (i ? "," : "") + std::to_string(song.tokens[i]);
        }
        FILE * f = fopen(tokens_path, "wb");
        if (f) {
            fwrite(csv.data(), 1, csv.size(), f);
            fputc('\n', f);
            fclose(f);
        }
    }

    if (latent_path) {
        FILE * f = fopen(latent_path, "wb");
        if (f) {
            fwrite(song.latents.data(), sizeof(float), song.latents.size(), f);
            fclose(f);
        }
    }

    if (score_path && !song.score.empty()) {
        FILE * f = fopen(score_path, "wb");
        if (f) {
            fwrite(song.score.data(), 1, song.score.size(), f);
            fclose(f);
        }
    }

    if (!audio_write(target.c_str(), song.audio.data(), song.T_audio, YUE2_SAMPLE_RATE, is_mp3, wav_fmt, r.mp3_bitrate,
                     r.peak_clip)) {
        return 1;
    }

    fprintf(stderr, "[Synth] Done: %.1f s of audio, seeds %lld and %lld -> %s\n",
            (float) song.T_audio / (float) YUE2_SAMPLE_RATE, (long long) r.lm_seed, (long long) r.seed, target.c_str());
    return 0;
}
