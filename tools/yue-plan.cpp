// yue-plan.cpp: symbolic planning CLI, a request to an ABC score
//
// Runs the first autoregressive stage alone and writes the composition the
// model intends to play. The score is the white box interface: read it, edit
// it, and hand it back to the synthesis stage through the same request.

#include "bpe.h"
#include "generate.h"
#include "prompt.h"
#include "request.h"
#include "version.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

static void print_usage(const char * prog) {
    fprintf(stderr, "yue2.cpp %s\n\n", YUE2_VERSION);
    fprintf(stderr,
            "Usage: %s --model <gguf> --request <json> [options]\n"
            "\n"
            "Required:\n"
            "  --model <gguf>         Backbone GGUF\n"
            "  --request <json>       Input request JSON\n"
            "\n"
            "Optional:\n"
            "  --out <path>           Output score (default: score.abc)\n"
            "  --lm-seed <N>          Token sampling seed (default: random)\n"
            "\n"
            "Debug:\n"
            "  --max-seq <N>          KV cache size (default: model context)\n"
            "  --dump-tokens <path>   Dump prefix token IDs (CSV)\n"
            "  --no-fa                Disable flash attention\n"
            "  --clamp-fp16           Clamp hidden states to FP16 range\n",
            prog);
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

    const char * model_path = nullptr;
    const char * out_path   = "score.abc";
    const char * dump_path  = nullptr;
    int          max_seq    = 0;
    bool         no_fa      = false;
    bool         clamp_fp16 = false;

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
        } else if (!strcmp(argv[i], "--request") && !last) {
            i++;  // parsed before the flag pass so the flags override it
        } else if (!strcmp(argv[i], "--out") && !last) {
            out_path = argv[++i];
        } else if (!strcmp(argv[i], "--lm-seed") && !last) {
            r.lm_seed = atoll(argv[++i]);
        } else if (!strcmp(argv[i], "--max-seq") && !last) {
            max_seq = atoi(argv[++i]);
        } else if (!strcmp(argv[i], "--dump-tokens") && !last) {
            dump_path = argv[++i];
        } else if (!strcmp(argv[i], "--no-fa")) {
            no_fa = true;
        } else if (!strcmp(argv[i], "--clamp-fp16")) {
            clamp_fp16 = true;
        } else if (!strcmp(argv[i], "--help") || !strcmp(argv[i], "-h")) {
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
    if (r.style.empty() && r.lyrics.empty()) {
        fprintf(stderr, "[Plan] ERROR: the request carries neither style nor lyrics\n\n");
        print_usage(argv[0]);
        return 1;
    }

    Yue2Cot cot;
    if (r.cot == "full") {
        cot = YUE2_COT_FULL;
    } else if (r.cot == "melody") {
        cot = YUE2_COT_MELODY;
    } else {
        fprintf(stderr, "[Plan] FATAL: cot must be full or melody to write a score\n");
        return 1;
    }
    if (!yue2_sampling_valid(r.abc_sampling, "abc")) {
        return 1;
    }
    request_resolve_seed(&r);

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
                                                    cot, r.style, r.lyrics, nullptr);

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
    if (!yue2_generate(&lm, prefix, {}, 1.0f, r.abc_sampling, r.lm_seed, YUE2_PHASE_ABC, &plan)) {
        qw3lm_free(&lm);
        return 1;
    }

    std::string score = bpe_decode(&tok, plan.tokens);
    if (!write_file(out_path, score)) {
        qw3lm_free(&lm);
        return 1;
    }

    qw3lm_free(&lm);
    fprintf(stderr, "[Plan] Prefix %zu tokens, score %zu tokens%s, seed %lld -> %s\n", prefix.size(),
            plan.tokens.size(), plan.truncated ? " (truncated)" : "", (long long) r.lm_seed, out_path);
    return 0;
}
