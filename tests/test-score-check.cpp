// test-score-check: a planned score nothing can be sung from, pure CPU.

#include "score-check.h"

#include <cstdio>
#include <string>

static int failures = 0;

static void check(bool ok, const char * what) {
    if (!ok) {
        fprintf(stderr, "[ERROR] %s\n", what);
        failures++;
    }
}

static const std::string GOOD =
    "X:1\nT:\nM:2/4\nL:1/32\nQ:1/4=70\nV: Vocal clef=treble name=\"Vocal Melody\" snm=\"Vocal\"\n"
    "V: Ins clef=treble name=\"Ins Melody\" snm=\"Inst.\"\nK:Em\n% intro\nV: Vocal\n"
    "z12\"Em\"z4|\"Em\"z16|\"C\"z16|\nV: Ins\nZ|E4B4f2g4d2-|d2B4B2A2G2F2G2|\n% verse\nV: Vocal\n"
    "|:\"Em\"e8b8|\"C\"e8a4f4:|[K:G]\"G\"g16|\n";

int main(int argc, char ** argv) {
    // with files: the verdict on each score, for real plans
    if (argc > 1) {
        int bad = 0;
        for (int i = 1; i < argc; i++) {
            FILE * f = fopen(argv[i], "rb");
            if (!f) {
                fprintf(stderr, "[ERROR] cannot read %s\n", argv[i]);
                return 1;
            }
            std::string text;
            char        buf[4096];
            size_t      n;
            while ((n = fread(buf, 1, sizeof buf, f)) > 0) {
                text.append(buf, n);
            }
            fclose(f);
            std::string problem = yue2_score_problem(text);
            if (!problem.empty()) {
                bad++;
                printf("%s: %s\n", argv[i], problem.c_str());
            }
        }
        printf("%d of %d scores refused\n", bad, argc - 1);
        return 0;
    }
    check(yue2_score_problem(GOOD).empty(), "a well-formed score passes");
    check(yue2_score_problem("X:1\nM:C\nL:1/8\nK:C\nV:1\nCDEF|GABc|\n").empty(), "common time passes");
    check(yue2_score_problem("X:1\nL:1/8\nK:C\nV:1\nCDEF|\n") == "its header has no well-formed M:", "no meter");
    check(yue2_score_problem("X:1\nM:4/4\nL:1/8\nV:1\nCDEF|\n") == "its header has no well-formed K:", "no key");
    check(yue2_score_problem("X:1\nM:4/x\nL:\nK:C\nV:1\nCDEF|\n") == "its header has no well-formed M:, L:",
          "malformed meter and length");
    check(yue2_score_problem("X:1\nM:4/4\nL:1/8\nK:C\n") == "it has no voice with bars", "no body");
    check(yue2_score_problem("X:1\nM:4/4\nL:1/8\nK:C\nV:1\nCD:E:F|G2A2:B|\n").rfind("colons stand inside", 0) == 0,
          "colons in a note run");
    check(yue2_score_stray_colons("|:CDEF:|::GABc|") == 0, "repeat bars are no stray colons");
    check(yue2_score_stray_colons("\"A:7\"C[K:G]D") == 0, "colons in chords and inline fields are not stray");
    check(yue2_score_excerpt("K:C\n\xd0\xb0\xe4\xb8", 64) == "K:C\n????", "a log excerpt is printable ASCII");
    check(yue2_score_excerpt("abcdef", 3) == "abc", "an excerpt stops at its limit");
    // yue2_score_fill_header: a plan whose only fault is a dropped header is made
    // singable with the trained defaults; one wrong in the body still is not.
    auto rescued = [](const std::string & abc) {
        return !yue2_score_problem(abc).empty() && yue2_score_problem(yue2_score_fill_header(abc)).empty();
    };
    check(rescued("X:1\nV: Vocal\nc4d4e4f4|g4a4b4c'4|\nV: Ins\nZ4|\n"), "a headerless plan is filled and sings");
    check(rescued("X:1\nM:4/4\nL:1/16\nV: Vocal\nc4d4e4f4|\nV: Ins\nZ4|\n"), "a dropped key is filled in after meter and length");
    check(rescued("X:1\nK:C\nV: Vocal\nc4d4e4f4|\nV: Ins\nZ4|\n"), "a dropped meter and length are filled in");
    check(rescued("V: Vocal\nc4d4e4f4|\nV: Ins\nZ4|\n"), "a plan with no X: line is filled at its top");
    check(yue2_score_fill_header(GOOD) == GOOD, "a well-formed header is left untouched");
    check(!yue2_score_problem(yue2_score_fill_header("V: Vocal\nc4 d4\nV: Ins\nZ\n")).empty(), "a body without bars is not rescued");
    check(!yue2_score_problem(yue2_score_fill_header("X:1\nV: Vocal\nc4:d4|\nV: Ins\nZ4|\n")).empty(), "stray colons are not rescued");
    {
        // a plan with no header and no bars is reported for what is left once the header is filled in
        const char * barless = "V: Vocal\nc4 d4\nV: Ins\nZ\n";
        const std::string before = yue2_score_problem(barless);
        const std::string after  = yue2_score_problem(yue2_score_fill_header(barless));
        check(!after.empty() && after != before && after.find("M:") == std::string::npos,
              "the reason left after the header is filled in names no header");
    }
    if (failures) {
        fprintf(stderr, "[ERROR] %d checks failed\n", failures);
        return 1;
    }
    fprintf(stderr, "[OK] test-score-check\n");
    return 0;
}
