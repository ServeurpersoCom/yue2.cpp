// score-check.h: a planned score nothing can be sung from
//
// Adapters pushed past their limits, or a seed that goes astray, make the
// planner write garbage: no key, no meter, colons inside the note runs. The
// semantic stage would then spend minutes on it. The plan is read once it is
// written and the song stops there, in seconds, with what is wrong.
#pragma once

#include <cstdio>
#include <string>

// "M:4/4", "L:1/16": a positive fraction and nothing after it
static bool yue2_score_fraction(const std::string & v) {
    int  num = 0, den = 0;
    char end = 0;
    return sscanf(v.c_str(), "%d/%d%c", &num, &den, &end) == 2 && num > 0 && den > 0;
}

// A field line: a letter, then ':'
static bool yue2_score_field(const std::string & line) {
    return line.size() >= 2 && line[1] == ':' &&
           ((line[0] >= 'A' && line[0] <= 'Z') || (line[0] >= 'a' && line[0] <= 'z'));
}

// The colons of a note line outside chord symbols, inline fields [K:...]
// and repeat bars (|: :| ::)
static int yue2_score_stray_colons(const std::string & line) {
    int  stray  = 0;
    bool quoted = false;
    int  depth  = 0;
    for (size_t i = 0; i < line.size(); i++) {
        char c = line[i];
        if (c == '"') {
            quoted = !quoted;
        } else if (quoted) {
            continue;
        } else if (c == '[') {
            depth++;
        } else if (c == ']') {
            depth = depth > 0 ? depth - 1 : 0;
        } else if (c == ':' && depth == 0) {
            char before = i > 0 ? line[i - 1] : 0;
            char after  = i + 1 < line.size() ? line[i + 1] : 0;
            if (before != '|' && after != '|' && before != ':' && after != ':') {
                stray++;
            }
        }
    }
    return stray;
}

// The start of a score for a log line: printable ASCII and newlines only, the
// rest as '?'. A garbage plan holds partial UTF-8 sequences, and a reader of
// the log as UTF-8 text would stop at the first one.
static std::string yue2_score_excerpt(const std::string & abc, size_t limit) {
    std::string out;
    for (size_t i = 0; i < abc.size() && out.size() < limit; i++) {
        unsigned char c = (unsigned char) abc[i];
        out += (c == '\n' || (c >= 0x20 && c < 0x7F)) ? (char) c : '?';
    }
    return out;
}

// What makes a score unusable, "" when nothing does
static std::string yue2_score_problem(const std::string & abc) {
    bool        meter = false, length = false, key = false, voice = false, bars = false;
    int         stray = 0;
    size_t      from  = 0;
    std::string first_stray;
    while (from < abc.size()) {
        size_t      nl   = abc.find('\n', from);
        std::string line = abc.substr(from, nl == std::string::npos ? std::string::npos : nl - from);
        from             = nl == std::string::npos ? abc.size() : nl + 1;
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        if (line.empty() || line[0] == '%') {
            continue;
        }
        if (yue2_score_field(line)) {
            std::string v = line.substr(2);
            size_t      a = v.find_first_not_of(" \t");
            v             = a == std::string::npos ? std::string() : v.substr(a);
            while (!v.empty() && (v.back() == ' ' || v.back() == '\t')) {
                v.pop_back();
            }
            if (!key && line[0] == 'M') {
                meter = meter || yue2_score_fraction(v) || v == "C" || v == "C|" || v == "none";
            } else if (!key && line[0] == 'L') {
                length = length || yue2_score_fraction(v);
            } else if (line[0] == 'K') {
                key = key || !v.empty();
            } else if (line[0] == 'V') {
                voice = true;
            }
            continue;
        }
        bars = bars || line.find('|') != std::string::npos;
        int here = yue2_score_stray_colons(line);
        if (here > 0 && first_stray.empty()) {
            first_stray = line.size() > 40 ? line.substr(0, 40) + "..." : line;
        }
        stray += here;
    }
    std::string missing;
    for (auto [have, name] : { std::pair<bool, const char *>{ meter, "M:" }, { length, "L:" }, { key, "K:" } }) {
        if (!have) {
            missing += (missing.empty() ? "" : ", ") + std::string(name);
        }
    }
    if (!missing.empty()) {
        return "its header has no well-formed " + missing;
    }
    if (!voice || !bars) {
        return "it has no voice with bars";
    }
    if (stray > 0) {
        return "colons stand inside its note runs (" + std::to_string(stray) + ", first in \"" + first_stray + "\")";
    }
    return "";
}
