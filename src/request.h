#pragma once
// request.h: YuE2 generation request (JSON serialization)
//
// Pure data container + JSON read/write. Zero business logic.
// Only fields the pipeline consumes: the protocol constants (vocabulary
// slices, sampling presets, frame rate) live in the pipeline, not here.

#include "sampling.h"

#include <cstdint>
#include <string>

struct Yue2Request {
    // text content
    std::string style;   // ""
    std::string lyrics;  // ""

    // symbolic plan. Empty in melody or full mode makes the model write one,
    // and the score it produces comes back in the reply so it can be edited
    // and submitted again.
    std::string abc;  // ""

    // chain of thought mode: "full", "melody" or "off"
    std::string cot;  // "full"

    // target length in seconds, the budget the semantic stage stops at. The
    // preset of the stage caps it, so the shorter of the two wins.
    float duration;  // 360

    // generation. Two seeds: the token draw consumes lm_seed as a Philox key,
    // the acoustic noise consumes seed as an mt19937 seed. Splitting them is
    // ours, the release runs both from one. Stored in int64_t to land positive
    // after rd().
    int64_t lm_seed;  // -1 = random
    int64_t seed;     // -1 = random
    int     steps;    // 32, midpoint steps of the flow matching ODE

    // batching: number of songs generated from this prompt. Song i draws
    // its tokens with lm_seed + i, consecutive seeds.
    int lm_batch_size;  // 1

    // number of flow matching variations per song, consecutive noise seeds
    // (seed + j) on the same semantic stream. Output order is song-major:
    // song * synth_batch_size + variation.
    int synth_batch_size;  // 1

    // sampling of each autoregressive stage, the checkpoint presets by default
    Yue2Sampling abc_sampling;
    Yue2Sampling semantic_sampling;

    // semantic stream (CSV of codec values, 25 per second). Non empty replaces
    // the autoregressive stage: the prefix and the codes are prefilled in one
    // forward, so re-rendering with other ODE steps or another decoder costs a
    // single pass instead of the whole token loop.
    std::string semantic_tokens;  // ""

    // classifier free guidance on the semantic stage. Negative applies the
    // protocol default, which is 1.01 in off mode and 1.0 otherwise, and a
    // scale of exactly 1.0 keeps a single branch.
    float cfg_scale;  // -1

    // output normalization percentile control, the peak being the
    // 1 - peak_clip / 1e6 percentile of the absolute signal
    int peak_clip;  // 10

    // audio output format: "mp3", "wav16", "wav24", "wav32"
    std::string output_format;

    // MP3 encoder bitrate in kbps, used when output_format is "mp3".
    // WAV outputs ignore this field.
    int mp3_bitrate;  // 128
};

// fills every field with its default
void request_init(Yue2Request * r);

// parses a JSON string, missing fields keep their default
bool request_parse_json(Yue2Request * r, const char * json);

// parses a JSON file, missing fields keep their default
bool request_parse(Yue2Request * r, const char * path);

// serializes, sparse skips the fields left at their default
std::string request_to_json(const Yue2Request * r, bool sparse = true);

// resolves a negative seed to a random positive one
void request_resolve_seed(Yue2Request * r);

// the request that renders one track of a batch again without the
// autoregression: its score, its semantic stream and the two seeds it consumed
Yue2Request request_replay(const Yue2Request & base,
                           const std::string & abc,
                           const std::string & tokens,
                           int                 song,
                           int                 variation);
