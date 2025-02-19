#!/bin/bash

# Function to remove logs.txt if it exists inside the task folder
remove_logs() {
    task_id=$1
    if [ -f "tasks/$task_id/logs.txt" ]; then
        echo "Deleting old logs.txt in task $task_id..."
        rm "tasks/$task_id/logs.txt"
    fi
}

# Function to remove the main function from all .cpp files in the src directory
remove_main_from_src() {
    task_id=$1
    src_dir="tasks/$task_id/src"

    # Check if the src directory exists
    if [ -d "$src_dir" ]; then
        echo "Processing src directory for task $task_id to remove main functions..."
        # Loop through all .cpp files in the src directory
        for cpp_file in "$src_dir"/*.cpp; do
            if [ -f "$cpp_file" ]; then
                echo "Removing main function from $cpp_file..."
                awk '
BEGIN { in_main = 0; braces = 0 }
/^[ \t]*int[ \t]+main[ \t]*\(.*\)/ { in_main = 1; braces = 0 }
/^[ \t]*{/ { if (in_main) braces++ }
/^[ \t]*}/ { if (in_main && --braces == 0) { in_main = 0; next } }
!in_main { print }
' "$cpp_file" > "${cpp_file}.tmp" && mv "${cpp_file}.tmp" "$cpp_file"
            fi
        done
    else
        echo "No src directory found for task $task_id."
    fi
}

run_task() {
    task_id=$1

    # Check if the task directory exists
    if [ ! -d "tasks/$task_id" ]; then
        echo "Task $task_id does not exist!"
        return 1
    fi

    echo "Running task $task_id..."

    # Remove all main functions from the src directory
    remove_main_from_src "$task_id"

    # Create build directory if it doesn't exist
    if [ ! -d "tasks/$task_id/build" ]; then
        echo "Build directory not found. Creating..."
        mkdir -p tasks/$task_id/build
    fi

    # Remove old logs.txt if it exists inside the task folder
    remove_logs $task_id

    # Clean up old files from the build directory
    echo "Cleaning up old files in build directory..."
    rm -rf tasks/$task_id/build/* && rm -rf tasks/$task_id/CMakeFiles tasks/$task_id/CMakeCache.txt

    # Navigate to the build directory
    pushd tasks/$task_id/build > /dev/null

    # Run cmake to generate build files from the task-specific CMakeLists.txt
    echo "Running cmake to generate build files..."
    cmake ..  # This assumes each task folder contains its own CMakeLists.txt

    # Build the project using make
    echo "Building the project..."
    make -k

    # Run the tests with verbose output and redirect output to logs.txt inside the task folder
    echo "Running tests with verbose output..."
    {
        ctest -V --timeout 5 | sed -E '/^\/Users\/ittehad\/Documents\/Coding\/Python\/Turing\//d'

        ctest --timeout 5
        
    } >> "../logs.txt" 2>&1

    echo "Tests have been run for task $task_id. Check tasks/$task_id/logs.txt for the output."

    # Return to the previous directory
    popd > /dev/null
}


# Function to fetch all task IDs and run tests for each
run_all_tasks() {
    echo "Fetching all task IDs and running tests for each..."

    for task_dir in tasks/*; do
        if [ -d "$task_dir" ]; then
            task_id=$(basename "$task_dir")
            # Remove old logs for the task
            remove_logs "$task_id"
            run_task "$task_id"
        fi
    done

    echo "All tasks have been processed."
}

# Main script logic
if [ -z "$1" ]; then
    echo "No task ID provided. Please provide a task ID or use the 'ALL' option to run all tasks."
    exit 1
else
    if [ "$1" == "ALL" ]; then
        run_all_tasks
    else
        run_task $1
    fi
fi

