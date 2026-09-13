// yue-transcribe.cpp: audio to score CLI
//
// Runs the SheetSage2 transcriber on a recording and writes the ABC score
// it hears: melody voices alone by default, the score the cover path of
// YuE2 takes as its abc with cot melody, or with the chord symbols kept.
#include "sheetsage.h"
#include "version.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

static void print_usage(const char * prog) {
    fprintf(stderr, "yue2.cpp %s\n\n", YUE2_VERSION);
    fprintf(stderr,
            "Usage: %s --model <gguf> --audio <file> [options]\n"
            "\n"
            "Required:\n"
            "  --model <gguf>         Transcriber GGUF\n"
            "  --audio <file>         Recording to transcribe (WAV or MP3)\n"
            "\n"
            "Optional:\n"
            "  --out <path>           Output score (default: score.abc)\n"
            "  --chords               Keep the chord symbols (default: melody voices alone)\n"
            "\n"
            "Debug:\n"
            "  --no-fa                Disable flash attention\n"
            "  --dump <dir>           Dump intermediate tensors\n",
            prog);
}

int main(int argc, char ** argv) {
    if (argc < 2) {
        print_usage(argv[0]);
        return 1;
    }
    const char * model_path = nullptr;
    const char * audio_path = nullptr;
    const char * out_path   = "score.abc";
    const char * dump_dir   = nullptr;
    bool         chords     = false;
    bool         no_fa      = false;
    for (int i = 1; i < argc; i++) {
        bool last = i + 1 >= argc;
        if (!strcmp(argv[i], "--model") && !last) {
            model_path = argv[++i];
        } else if (!strcmp(argv[i], "--audio") && !last) {
            audio_path = argv[++i];
        } else if (!strcmp(argv[i], "--out") && !last) {
            out_path = argv[++i];
        } else if (!strcmp(argv[i], "--chords")) {
            chords = true;
        } else if (!strcmp(argv[i], "--no-fa")) {
            no_fa = true;
        } else if (!strcmp(argv[i], "--dump") && !last) {
            dump_dir = argv[++i];
        } else {
            fprintf(stderr, "[Transcribe] ERROR: unknown argument %s\n", argv[i]);
            print_usage(argv[0]);
            return 1;
        }
    }
    if (!model_path || !audio_path) {
        fprintf(stderr, "[Transcribe] ERROR: --model and --audio are required\n\n");
        print_usage(argv[0]);
        return 1;
    }

    std::vector<float> audio;
    if (!ss2_load_audio(audio_path, &audio)) {
        fprintf(stderr, "[Transcribe] FATAL: cannot read %s\n", audio_path);
        return 1;
    }
    SheetSage2 m;
    if (!ss2_load(&m, model_path)) {
        return 1;
    }
    m.use_flash_attn = m.use_flash_attn && !no_fa;
    DebugDumper dbg;
    debug_init(&dbg, dump_dir);

    std::string abc, error;
    bool        ok = ss2_transcribe(&m, audio.data(), (int) audio.size(), !chords, &abc, &error, &dbg);
    ss2_free(&m);
    if (!ok) {
        fprintf(stderr, "[Transcribe] FATAL: %s\n", error.empty() ? "transcription failed" : error.c_str());
        return 1;
    }
    FILE * f = fopen(out_path, "wb");
    if (!f || fwrite(abc.data(), 1, abc.size(), f) != abc.size()) {
        fprintf(stderr, "[Transcribe] FATAL: cannot write %s\n", out_path);
        return 1;
    }
    fclose(f);
    fprintf(stderr, "[Transcribe] Done: %s -> %s\n", audio_path, out_path);
    return 0;
}
