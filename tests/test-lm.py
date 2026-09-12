#!/usr/bin/env python3
"""Parity of the backbone autoregressive path, prefill and decode.

Owns both sides: drives the trunk of the checkpoint modeling code directly so
the run stays on the AR weight set, runs the GGML harness on the same prompt,
compares the last token logits and the argmax. The FP16 clamp flag is
specified neutral, so the same cases run again clamped against the same
reference.
Run from the tests/ directory.

Usage:
    ./test-lm.py
    GGML_BACKEND=CPU ./test-lm.py
"""
import os
import subprocess
import sys

import numpy as np
import torch

BIN = "../build/test-lm"
CKPT = "../checkpoints/YuE2-3B"
GGUF = "../models/YuE2-3B-BF16.gguf"
TMP = "tmp"
MAX_REL = 2e-2

# EOD, a short English prompt, the empty score slot, then two codec tokens
IDS = [151643, 22574, 11, 33897, 2220, 3122, 11, 8205, 2990, 25407, 198, 151847, 151848, 151851, 153087, 161729]


def report(label, ref, got, max_rel):
    if ref.size != got.size:
        print("[Parity] %s FAIL size %d vs %d" % (label, ref.size, got.size))
        return False
    rel = float(np.sqrt(((ref - got) ** 2).mean()) / (np.sqrt((ref ** 2).mean()) + 1e-20))
    mx = float(np.abs(ref - got).max())
    a, b = int(ref.argmax()), int(got.argmax())
    ok = rel <= max_rel and a == b
    print("[Parity] %s: rel rms %.3e max abs %.3e argmax %d vs %d %s" % (label, rel, mx, a, b, "OK" if ok else "FAIL"))
    return ok


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    os.makedirs(TMP, exist_ok=True)

    sys.path.insert(0, CKPT)
    from modeling_yue2 import YuE2ForCausalLM

    model = YuE2ForCausalLM.from_pretrained(CKPT, torch_dtype=torch.float32, local_files_only=True)
    model.eval()

    def logits_of(seq):
        tokens = torch.tensor([seq])
        positions = torch.arange(len(seq))[None]
        hidden, _ = model.model(input_ids=tokens, position_ids=positions, use_cache=False)
        return model.lm_head(hidden[0, -1]).numpy().astype("float32")

    with torch.no_grad():
        # The harness prefills every id but the last, then decodes that one
        ref = {"lm-prefill": logits_of(IDS[:-1]), "lm-decode": logits_of(IDS)}

    ok = True
    for suffix, flags in (("", []), ("-clamp", ["--clamp-fp16"])):
        subprocess.run([BIN, GGUF, TMP + "/lm"] + flags + [str(i) for i in IDS], check=True)
        for label, path in (("lm-prefill", "/lm_prefill_logits.bin"), ("lm-decode", "/lm_decode_logits.bin")):
            got = np.fromfile(TMP + path, dtype="float32")
            ok = report(label + suffix, ref[label], got, MAX_REL) and ok

    sys.exit(0 if ok else 1)


main()
