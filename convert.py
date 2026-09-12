#!/usr/bin/env python3
# Convert the YuE2 checkpoints to GGUF, native dtype byte perfect.
# Reads checkpoints/, writes models/. Run ./checkpoints.sh first.
#
# Components (HF repo -> GGUF):
#   YuE2-3B/  -> YuE2-3B-BF16.gguf  (3.6B AR/NAR Mixture-of-Transformers, with the
#                                    config json and the qwen.tiktoken BPE embedded;
#                                    the sinusoidal latent_pos_embed.pe table is
#                                    rebuilt at load and is not stored)
#   YuE2-Vae/ -> YuE2-Vae-F32.gguf  (Oobleck SnakeBeta VAE, encoder and decoder,
#                                    positional nn.Sequential names mapped onto the
#                                    vae.h vocabulary; weight norm pairs and
#                                    log scale snake parameters stay raw, vae.h
#                                    folds w = g*v/||v|| and exponentiates at load)

import os
import sys
import json
import struct
import base64
import numpy as np
import gguf

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CHECKPOINT_DIR = os.path.join(SCRIPT_DIR, "checkpoints")
OUTPUT_DIR = os.path.join(SCRIPT_DIR, "models")

COMPONENTS = {
    "backbone": "YuE2-3B",
    "vae":      "YuE2-Vae",
}

def log(tag, msg):
    print("[%s] %s" % (tag, msg), file=sys.stderr, flush=True)

# Safetensors reader
def read_sf_header(path):
    with open(path, "rb") as f:
        n = struct.unpack("<Q", f.read(8))[0]
        meta = json.loads(f.read(n))
    meta.pop("__metadata__", None)
    return meta, 8 + n

def find_sf_files(model_dir):
    """Return the list of safetensors paths (single or sharded)."""
    single = os.path.join(model_dir, "model.safetensors")
    if os.path.exists(single):
        return [single]
    index = os.path.join(model_dir, "model.safetensors.index.json")
    if os.path.exists(index):
        with open(index, "r", encoding="utf-8") as f:
            idx = json.load(f)
        shards = sorted(set(idx["weight_map"].values()))
        return [os.path.join(model_dir, s) for s in shards]
    raise FileNotFoundError("no safetensors in %s" % model_dir)

def stream_native_tensors(w, model_dir, tag, rename=None, skip=()):
    """Stream every safetensors tensor into the writer byte perfect in its native dtype."""
    BF16 = gguf.GGMLQuantizationType.BF16
    F32 = gguf.GGMLQuantizationType.F32
    count = 0
    for path in find_sf_files(model_dir):
        meta, data_start = read_sf_header(path)
        with open(path, "rb") as f:
            for name in sorted(meta):
                if name in skip:
                    log(tag, "skip %s %s" % (name, meta[name]["shape"]))
                    continue
                t = meta[name]
                f.seek(data_start + t["data_offsets"][0])
                raw = f.read(t["data_offsets"][1] - t["data_offsets"][0])
                out = rename(name) if rename else name
                if t["dtype"] == "BF16":
                    arr = np.frombuffer(raw, dtype=np.uint16).reshape(t["shape"])
                    w.add_tensor(out, arr, raw_dtype=BF16)
                elif t["dtype"] == "F32":
                    arr = np.frombuffer(raw, dtype=np.float32).reshape(t["shape"])
                    w.add_tensor(out, arr, raw_dtype=F32)
                else:
                    raise SystemExit("unexpected dtype %s for %s" % (t["dtype"], name))
                count += 1
    log(tag, "%d tensors" % count)

# VAE naming: the release exports nn.Sequential positions, vae.h reads stage names.
# Decoder: conv1 -> 6 blocks(snake1, conv_t1, 3 res units) -> snake1 -> conv2
# Encoder: conv1 -> 6 blocks(3 res units, snake1, conv1) -> snake1 -> conv2
VAE_STAGE = {0: "conv1", 7: "snake1", 8: "conv2"}
VAE_UNIT = {0: "snake1", 1: "conv1", 2: "snake2", 3: "conv2"}
VAE_INNER = {
    "decoder": {0: "snake1", 1: "conv_t1", 2: "res_unit1", 3: "res_unit2", 4: "res_unit3"},
    "encoder": {0: "res_unit1", 1: "res_unit2", 2: "res_unit3", 3: "snake1", 4: "conv1"},
}

def rename_vae(name):
    """Map one positional tensor name onto the vae.h naming vocabulary."""
    p = name.split(".")
    side, leaf = p[0], p[-1]
    if side not in VAE_INNER or any(k != "layers" for k in p[1:-1:2]):
        raise SystemExit("unexpected VAE tensor: %s" % name)
    idx = [int(x) for x in p[2:-1:2]]
    if len(idx) == 1:
        return "%s.%s.%s" % (side, VAE_STAGE[idx[0]], leaf)
    parts = [side, "block.%d" % (idx[0] - 1), VAE_INNER[side][idx[1]]]
    if len(idx) == 3:
        parts.append(VAE_UNIT[idx[2]])
    return ".".join(parts + [leaf])

# GPT-2 byte level encoding table, the vocab key alphabet bpe.h expects
def build_byte_encoder():
    bs = list(range(ord("!"), ord("~") + 1))
    bs += list(range(0xA1, 0xAC + 1))
    bs += list(range(0xAE, 0xFF + 1))
    cs = list(bs)
    n = 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    table = [""] * 256
    for b, c in zip(bs, cs):
        table[b] = chr(c)
    return table

# Special tokens of the frozen text/ABC tokenizer, appended after the 151643 ranks
def special_tokens():
    specials = ["<|endoftext|>", "<|im_start|>", "<|im_end|>", "<R>", "<S>", "<X>", "<mask>", "<sep>"]
    specials += ["<extra_%d>" % i for i in range(200)]
    specials[204:206] = ["<abc>", "</abc>"]
    return specials

def bpe_split(ranks, token, limit):
    """Merge the bytes of a token while every merge stays below its own rank."""
    parts = [bytes([b]) for b in token]
    while len(parts) > 1:
        best, best_rank = None, limit
        for i in range(len(parts) - 1):
            r = ranks.get(parts[i] + parts[i + 1])
            if r is not None and r < best_rank:
                best, best_rank = i, r
        if best is None:
            break
        parts[best : best + 2] = [parts[best] + parts[best + 1]]
    return parts

def add_tiktoken_bpe(w, model_dir, tag):
    """qwen.tiktoken ranks -> GPT-2 style token list and merge list for bpe.h."""
    path = os.path.join(model_dir, "qwen.tiktoken")
    ranks = {}
    with open(path, "rb") as f:
        for line in f:
            if not line.strip():
                continue
            token, rank = line.split()
            ranks[base64.b64decode(token)] = int(rank)
    if len(ranks) != 151643:
        raise SystemExit("expected 151643 ordinary tokens, got %d" % len(ranks))

    byte2str = build_byte_encoder()
    def encode(raw):
        return "".join(byte2str[b] for b in raw)

    specials = special_tokens()
    tokens = [""] * (len(ranks) + len(specials))
    for raw, rank in ranks.items():
        tokens[rank] = encode(raw)
    for i, text in enumerate(specials):
        tokens[len(ranks) + i] = text

    merges = []
    unreachable = 0
    for raw, rank in sorted(ranks.items(), key=lambda kv: kv[1]):
        if len(raw) < 2:
            continue
        parts = bpe_split(ranks, raw, rank)
        if len(parts) == 2:
            merges.append(encode(parts[0]) + " " + encode(parts[1]))
        else:
            unreachable += 1

    w.add_tokenizer_model("gpt2")
    w.add_token_list(tokens)
    w.add_token_merges(merges)
    log(tag, "tokenizer: %d tokens (%d specials), %d merges, %d unreachable"
        % (len(tokens), len(specials), len(merges), unreachable))

def convert_backbone():
    """YuE2-3B/ -> YuE2-3B-BF16.gguf, native BF16, config json and BPE embedded."""
    model_dir = os.path.join(CHECKPOINT_DIR, COMPONENTS["backbone"])
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    out_path = os.path.join(OUTPUT_DIR, "YuE2-3B-BF16.gguf")

    with open(os.path.join(model_dir, "config.json"), "r", encoding="utf-8") as f:
        cfg = json.load(f)

    w = gguf.GGUFWriter(out_path, arch="yue2")
    w.add_name("YuE2 AR/NAR Mixture-of-Transformers")
    w.add_string("yue2.config_json", json.dumps(cfg, separators=(",", ":")))

    add_tiktoken_bpe(w, model_dir, "backbone")
    stream_native_tensors(w, model_dir, "backbone", skip={"latent_pos_embed.pe"})

    w.write_header_to_file()
    w.write_kv_data_to_file()
    w.write_tensors_to_file()
    w.close()
    log("backbone", "wrote %s (%.1f MB)" % (out_path, os.path.getsize(out_path) / 1e6))

def convert_vae():
    """YuE2-Vae/ -> YuE2-Vae-F32.gguf, native F32, stage names, weight norm raw."""
    model_dir = os.path.join(CHECKPOINT_DIR, COMPONENTS["vae"])
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    out_path = os.path.join(OUTPUT_DIR, "YuE2-Vae-F32.gguf")

    w = gguf.GGUFWriter(out_path, arch="yue2-vae")
    w.add_name("YuE2 Oobleck VAE")
    w.add_uint32("yue2-vae.latent_channels", 64)
    w.add_uint32("yue2-vae.sampling_rate", 48000)
    w.add_array("yue2-vae.upsampling_ratios", [6, 5, 4, 4, 2, 2])

    stream_native_tensors(w, model_dir, "vae", rename=rename_vae)

    w.write_header_to_file()
    w.write_kv_data_to_file()
    w.write_tensors_to_file()
    w.close()
    log("vae", "wrote %s (%.1f MB)" % (out_path, os.path.getsize(out_path) / 1e6))

def convert(component):
    if component == "backbone":
        convert_backbone()
        return
    if component == "vae":
        convert_vae()

def main():
    if not os.path.isdir(CHECKPOINT_DIR):
        log("GGUF", "checkpoints/ not found")
        return 1

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    native = {"backbone": "BF16", "vae": "F32"}
    converted = 0
    for comp in COMPONENTS:
        output_path = os.path.join(OUTPUT_DIR, "%s-%s.gguf" % (COMPONENTS[comp], native[comp]))
        if os.path.exists(output_path):
            log("GGUF", "skip %s: %s exists" % (comp, os.path.basename(output_path)))
            converted += 1
            continue
        convert(comp)
        converted += 1

    log("GGUF", "done: %d model(s) in %s" % (converted, OUTPUT_DIR))
    return 0

if __name__ == "__main__":
    sys.exit(main())
