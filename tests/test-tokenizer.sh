#!/bin/bash

set -eo pipefail

for backend in CUDA0 CPU; do
    env GGML_BACKEND=$backend ./test-tokenizer.py 2>&1 | tee ${backend}-tokenizer.log
done
