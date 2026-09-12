// yue-plan.cpp: symbolic planning CLI, style and lyrics to an ABC score
//
// Runs the first autoregressive stage alone and writes the composition the
// model intends to play. The score is the white box interface: read it, edit
// it, and hand it back to the synthesis stage.

#include "bpe.h"
#include "generate.h"
#include "prompt.h"
#include "version.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

static void print_usage(const char * prog) {
    fprintf(stderr, "yue2.cpp %s\n\n", YUE2_VERSION);
    fprintf(stderr,
            "Usage: %s --model <gguf> --style <file> --lyrics <file> [options]\n"
            "\n"
            "Required:\n"
            "  --model <gguf>         Backbone GGUF\n"
            "  --style <file>         Style tags text file\n"
            "  --lyrics <file>        Lyrics text file\n"
            "\n"
            "Optional:\n"
            "  --out <path>           Output score (default: score.abc)\n"
            "  --cot <mode>           full or melody (default: full)\n"
            "  --seed <N>             Sampling seed (default: 831001)\n"
            "\n"
            "Debug:\n"
            "  --max-seq <N>          KV cache size (default: model context)\n"
            "  --dump-tokens <path>   Dump prefix token IDs (CSV)\n"
            "  --no-fa                Disable flash attention\n"
            "  --clamp-fp16           Clamp hidden states to FP16 range\n"
            "  --help                 Show this help\n",
            prog);
}

static bool read_file(const char * path, std::string * out) {
    FILE * f = fopen(path, "rb");
    if (!f) {
        fprintf(stderr, "[Plan] FATAL: cannot read %s\n", path);
        return false;
    }
    fseek(f, 0, SEEK_END);
    long size = ftell(f);
    fseek(f, 0, SEEK_SET);
    out->resize(size > 0 ? (size_t) size : 0);
    size_t got = out->empty() ? 0 : fread(&(*out)[0], 1, out->size(), f);
    fclose(f);
    if (got != out->size()) {
        fprintf(stderr, "[Plan] FATAL: cannot read %s\n", path);
        return false;
    }
    return true;
}

static bool write_file(const char * path, const std::string & data) {
    FILE * f = fopen(path, "wb");
    if (!f || fwrite(data.data(), 1, data.size(), f) != data.size()) {
        fprintf(stderr, "[Plan] FATAL: cannot write %s\n", path);
        return false;
    }
    fclose(f);
    return true;
}

int main(int argc, char ** argv) {
    if (argc < 2) {
        print_usage(argv[0]);
        return 1;
    }

    const char * model_path  = nullptr;
    const char * style_path  = nullptr;
    const char * lyrics_path = nullptr;
    const char * out_path    = "score.abc";
    const char * dump_path   = nullptr;
    Yue2Cot      cot         = YUE2_COT_FULL;
    int64_t      seed        = 831001;
    int          max_seq     = 0;
    bool         no_fa       = false;
    bool         clamp_fp16  = false;

    for (int i = 1; i < argc; i++) {
        bool last = i + 1 >= argc;
        if (!strcmp(argv[i], "--model") && !last) {
            model_path = argv[++i];
        } else if (!strcmp(argv[i], "--style") && !last) {
            style_path = argv[++i];
        } else if (!strcmp(argv[i], "--lyrics") && !last) {
            lyrics_path = argv[++i];
        } else if (!strcmp(argv[i], "--out") && !last) {
            out_path = argv[++i];
        } else if (!strcmp(argv[i], "--cot") && !last) {
            const char * mode = argv[++i];
            if (!strcmp(mode, "melody")) {
                cot = YUE2_COT_MELODY;
            } else if (strcmp(mode, "full") != 0) {
                fprintf(stderr, "[Plan] FATAL: --cot must be full or melody\n");
                return 1;
            }
        } else if (!strcmp(argv[i], "--seed") && !last) {
            seed = atoll(argv[++i]);
        } else if (!strcmp(argv[i], "--max-seq") && !last) {
            max_seq = atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--dump-tokens") && !last) {
            dump_path = argv[++i];
        } else if (!strcmp(argv[i], "--no-fa")) {
            no_fa = true;
        } else if (!strcmp(argv[i], "--clamp-fp16")) {
            clamp_fp16 = true;
        } else if (!strcmp(argv[i], "--help")) {
            print_usage(argv[0]);
            return 0;
        } else {
            fprintf(stderr, "[Plan] FATAL: unknown argument %s\n", argv[i]);
            return 1;
        }
    }

    if (!model_path) {
        fprintf(stderr, "[Plan] ERROR: --model is required\n\n");
        print_usage(argv[0]);
        return 1;
    }
    if (!style_path || !lyrics_path) {
        fprintf(stderr, "[Plan] ERROR: --style and --lyrics are required\n\n");
        print_usage(argv[0]);
        return 1;
    }

    std::string style, lyrics;
    if (!read_file(style_path, &style) || !read_file(lyrics_path, &lyrics)) {
        return 1;
    }

    BPETokenizer tok;
    if (!load_bpe_from_gguf(&tok, model_path)) {
        return 1;
    }

    Qwen3LM lm;
    if (!qw3lm_load(&lm, model_path, max_seq, 1)) {
        return 1;
    }
    lm.use_flash_attn = lm.use_flash_attn && !no_fa;
    lm.clamp_fp16     = clamp_fp16;

    // The score slot stays open: this stage is the one that fills it
    std::vector<int> prefix = yue2_build_prompt_ids([&tok](const std::string & text) { return bpe_encode(&tok, text); },
                                                    cot, style, lyrics, nullptr);

    if (dump_path) {
        std::string csv;
        for (size_t i = 0; i < prefix.size(); i++) {
            csv += (i ? "," : "") + std::to_string(prefix[i]);
        }
        if (!write_file(dump_path, csv + "\n")) {
            qw3lm_free(&lm);
            return 1;
        }
    }

    Yue2Generation plan;
    if (!yue2_generate(&lm, prefix, {}, 1.0f, YUE2_ABC_SAMPLING, seed, YUE2_PHASE_ABC, &plan)) {
        qw3lm_free(&lm);
        return 1;
    }

    std::string score = bpe_decode(&tok, plan.tokens);
    if (!write_file(out_path, score)) {
        qw3lm_free(&lm);
        return 1;
    }

    qw3lm_free(&lm);
    fprintf(stderr, "[Plan] Prefix %zu tokens, score %zu tokens%s -> %s\n", prefix.size(), plan.tokens.size(),
            plan.truncated ? " (truncated)" : "", out_path);
    return 0;
}
