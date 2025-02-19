#!/bin/bash

# Function to remove logs.txt if it exists inside the task folder
remove_logs() {
    task_id=$1
    if [ -f "tasks/$task_id/logs.txt" ]; then
        echo "Deleting old logs.txt in task $task_id..."
        rm "tasks/$task_id/logs.txt"
    fi

    rm -rf tasks/$task_id/logs/*
}

# Function to build all models response in this task 
build_all_code(){
    # Loop over all .cpp files in ../src
    for cppfile in ../src/*.cpp; do
        # Extract the filename (without path)
        filename=$(basename -- "$cppfile")
        # Remove the .cpp extension
        name="${filename%.cpp}"
        # Construct the CMake target name
        target="${name}_tests"

        # Construct the log file path
        logfile="../logs/${target}.log"

        echo "----------------------------------------"
        echo "Building target: ${target}"
        echo "Log file: ${logfile}"

        # Build the target, capturing stdout and stderr
        cmake --build . --target "$target" > "$logfile" 2>&1

        # Check if build succeeded
        if [ $? -eq 0 ]; then
            # Insert a dashed separator in the log
            echo "----------------------------------------" >> "$logfile"

            echo "Build succeeded! Running ${target}..."
            # Run the test executable, appending output to the same log file
            ./"${target}" >> "$logfile" 2>&1
        else
            echo "Build failed for ${target}, skipping test run..."
        fi
    done
}

# Function to run cmake and make for a specific task
run_task() {
    task_id=$1

    # Check if the task directory exists
    if [ ! -d "tasks/$task_id" ]; then
        echo "Task $task_id does not exist!"
        return 1
    fi

    echo "Running task $task_id..."

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
    cmake -G "MinGW Makefiles" ..  # This assumes each task folder contains its own CMakeLists.txt

    # Create the logs directory if it doesn't exist
    mkdir -p ../logs

    # Run batch build and test function 
    echo "Starting batch build and test..."
    build_all_code

    # Run the tests with verbose output and redirect output to logs.txt inside the task folder
    # echo "Running tests with verbose output..."
    # {
    #     ctest --timeout 5 
    # } >> "../logs.txt" 2>&1

    echo "Tests have been run for task $task_id. Check tasks/$task_id/logs for the output."

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


# !/bin/bash