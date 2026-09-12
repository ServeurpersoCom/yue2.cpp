// test-lm.cpp: backbone AR path parity harness
//
// Prefills a fixed token id sequence, then runs one decode step, dumping
// the logits and the last hidden state of both forwards for comparison
// against the torch reference. The FP16 clamp flag runs the same path clamped.

#include "qwen3-lm.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

int main(int argc, char ** argv) {
    bool clamp = argc > 3 && strcmp(argv[3], "--clamp-fp16") == 0;
    int  first = clamp ? 4 : 3;
    if (argc <= first) {
        fprintf(stderr, "usage: %s lm.gguf out_prefix [--clamp-fp16] id0 [id1 ...]\n", argv[0]);
        return 1;
    }

    std::vector<int> ids;
    for (int i = first; i < argc; i++) {
        ids.push_back(atoi(argv[i]));
    }

    Qwen3LM lm;
    if (!qw3lm_load(&lm, argv[1], 0, 1)) {
        return 1;
    }
    lm.clamp_fp16 = clamp;

    int                V = lm.cfg.vocab_size;
    int                H = lm.cfg.hidden_size;
    std::vector<float> logits(V), hidden(H);

    // Prefill all ids but the last, then decode the last id alone
    qw3lm_forward(&lm, ids.data(), (int) ids.size() - 1, 0, logits.data(), hidden.data());
    std::string p = std::string(argv[2]) + "_prefill";
    FILE *      f = fopen((p + "_logits.bin").c_str(), "wb");
    fwrite(logits.data(), sizeof(float), V, f);
    fclose(f);
    f = fopen((p + "_hidden.bin").c_str(), "wb");
    fwrite(hidden.data(), sizeof(float), H, f);
    fclose(f);

    int last = ids.back();
    qw3lm_forward(&lm, &last, 1, 0, logits.data(), hidden.data());
    p = std::string(argv[2]) + "_decode";
    f = fopen((p + "_logits.bin").c_str(), "wb");
    fwrite(logits.data(), sizeof(float), V, f);
    fclose(f);
    f = fopen((p + "_hidden.bin").c_str(), "wb");
    fwrite(hidden.data(), sizeof(float), H, f);
    fclose(f);

    fprintf(stderr, "[Test-LM] Prefill %d tokens + decode 1, V=%d H=%d\n", (int) ids.size() - 1, V, H);
    return 0;
}
