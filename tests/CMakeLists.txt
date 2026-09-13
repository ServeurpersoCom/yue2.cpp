# test-vae: Oobleck VAE decoder parity harness against the torch reference.
add_executable(test-vae test-vae.cpp)
link_ggml_backends(test-vae)

# test-lm: backbone AR path parity harness against the torch reference.
add_executable(test-lm test-lm.cpp)
link_ggml_backends(test-lm)

# test-nar: backbone NAR path parity harness against the torch reference.
add_executable(test-nar test-nar.cpp)
link_ggml_backends(test-nar)

# test-bpe: frozen tokenizer parity harness, pure CPU, no ggml.
add_executable(test-bpe test-bpe.cpp)
link_ggml_backends(test-bpe)

# test-sampling: AR sampling distribution parity harness, pure CPU, no ggml.
add_executable(test-sampling test-sampling.cpp)
target_include_directories(test-sampling PRIVATE ${CMAKE_SOURCE_DIR}/src)

# test-rng: PyTorch CPU generator parity harness, pure CPU, no ggml.
add_executable(test-rng test-rng.cpp)
target_include_directories(test-rng PRIVATE ${CMAKE_SOURCE_DIR}/src)

# test-draw: token draw parity harness, pure CPU, no ggml.
add_executable(test-draw test-draw.cpp)
target_include_directories(test-draw PRIVATE ${CMAKE_SOURCE_DIR}/src)

# test-sheetsage: SheetSage2 transcriber parity harness against the torch reference.
add_executable(test-sheetsage test-sheetsage.cpp)
target_link_libraries(test-sheetsage PRIVATE yyjson)
link_ggml_backends(test-sheetsage)
