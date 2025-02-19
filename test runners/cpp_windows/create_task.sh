#!/bin/bash

# Function to create task structure for a given task ID
create_task_structure() {
    task_id=$1

    # Check if the task directory already exists
    if [ -d "tasks/$task_id" ]; then
        echo "Task $task_id already exists!"
        return 1
    fi

    echo "Creating structure for task ID: $task_id"

    # Create task directory
    mkdir -p tasks/$task_id/src
    mkdir -p tasks/$task_id/tests

    # Create base files in src
    touch tasks/$task_id/src/base.cpp
    touch tasks/$task_id/src/ideal.cpp
    touch tasks/$task_id/src/incorrect.cpp
    touch tasks/$task_id/src/A.cpp
    touch tasks/$task_id/src/B.cpp
    touch tasks/$task_id/src/C.cpp

    # Create test file
    touch tasks/$task_id/tests/test_model.cpp

    # Create CMakeLists.txt in the task folder
cat > tasks/$task_id/CMakeLists.txt <<EOL
cmake_minimum_required(VERSION 3.14)
project(subset_sum_tests)

# Set C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Include GoogleTest via FetchContent
include(FetchContent)
FetchContent_Declare(
  googletest
  URL https://github.com/google/googletest/archive/refs/heads/main.zip
)
# For Windows: Prevent overriding the parent project's compiler/linker settings
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

# Enable testing
enable_testing()

# Collect all .cpp files from src/
file(GLOB IMPLEMENTATIONS "src/*.cpp")

# Iterate through each implementation and generate tests for each
foreach(IMPLEMENTATION \${IMPLEMENTATIONS})
    # Extract the implementation name (e.g., A, B, ideal, etc.)
    get_filename_component(IMPL_NAME \${IMPLEMENTATION} NAME_WE)

    # Generate a unique wrapper file for each implementation
    set(WRAPPER_TEMPLATE "\${CMAKE_CURRENT_SOURCE_DIR}/template_wrapper.h.in")
    set(WRAPPER_OUTPUT "\${CMAKE_CURRENT_BINARY_DIR}/wrapper_\${IMPL_NAME}.h")
    configure_file(\${WRAPPER_TEMPLATE} \${WRAPPER_OUTPUT} @ONLY)

    # Add a test executable for each implementation
    add_executable(\${IMPL_NAME}_tests tests/test_model.cpp)

    # Link the implementation indirectly through the wrapper
    target_include_directories(\${IMPL_NAME}_tests PRIVATE \${CMAKE_CURRENT_BINARY_DIR})
    target_compile_definitions(\${IMPL_NAME}_tests PRIVATE WRAPPER_FILE="\${WRAPPER_OUTPUT}")

    # Link GoogleTest
    target_link_libraries(\${IMPL_NAME}_tests GTest::gtest_main)

    # Register the test
    add_test(NAME \${IMPL_NAME}_tests COMMAND \${IMPL_NAME}_tests)
endforeach()
EOL


# Create template_wrapper.h.in
    cat > tasks/$task_id/template_wrapper.h.in <<EOL
#ifndef WRAPPER_H
#define WRAPPER_H

#include "../src/@IMPL_NAME@.cpp" // Use relative path to src directory

#endif // WRAPPER_H
EOL

    echo "Task structure for $task_id created."
}

# Check if a task ID is provided, otherwise print usage instructions
if [ -z "$1" ]; then
    echo "Please provide a task ID to create the structure for (e.g., 303990)."
    exit 1
else
    create_task_structure $1
fi
