import os
import re
import shutil
import subprocess
from pathlib import Path
from datetime import datetime
import csv

# Color codes for terminal output
class Colors:
    GREEN = '\033[0;32m'
    RED = '\033[0;31m'
    BLUE = '\033[0;34m'
    YELLOW = '\033[0;33m'  # Added yellow for FAILED_TO_RUN status
    NC = '\033[0m'  # No color

# Directory structure constants
CODE_DIR = "code"
TEST_DIR = "test"
RESULTS_DIR = "test_results"
SRC_MAIN = "src/main/java"
SRC_TEST = "src/test/java"
BUILD_GRADLE_FILE = "build.gradle"
COVERAGE_FILE = os.path.join(RESULTS_DIR, "coverage.txt")

class TestResult:
    def __init__(self, file_name):
        self.file_name = file_name
        self.status = "NOT_RUN"
        self.output = ""
        self.error = None
        self.timestamp = datetime.now()
        self.coverage = None

class CoverageMetrics:
    def __init__(self):
        self.instruction_coverage = 0
        self.branch_coverage = 0
        self.line_coverage = 0
        self.complexity_coverage = 0
        self.method_coverage = 0
        self.class_coverage = 0
        
        # Track raw numbers for calculating overall coverage
        self.total_lines = 0
        self.covered_lines = 0
        self.total_instructions = 0
        self.covered_instructions = 0
        self.total_branches = 0
        self.covered_branches = 0

def parse_jacoco_csv():
    coverage_file = "build/reports/jacoco/test/jacocoTestReport.csv"
    if not os.path.exists(coverage_file):
        return None

    metrics = CoverageMetrics()
    total_metrics = {
        'instructions': {'covered': 0, 'missed': 0},
        'branches': {'covered': 0, 'missed': 0},
        'lines': {'covered': 0, 'missed': 0}
    }
    
    with open(coverage_file, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Include coverage for all classes in the package
            if not row['CLASS'].startswith('org.junit') and not row['CLASS'].startswith('org.mockito'):
                # Accumulate coverage data
                total_metrics['instructions']['covered'] += int(row['INSTRUCTION_COVERED'])
                total_metrics['instructions']['missed'] += int(row['INSTRUCTION_MISSED'])
                total_metrics['branches']['covered'] += int(row['BRANCH_COVERED'])
                total_metrics['branches']['missed'] += int(row['BRANCH_MISSED'])
                total_metrics['lines']['covered'] += int(row['LINE_COVERED'])
                total_metrics['lines']['missed'] += int(row['LINE_MISSED'])
    
    # Calculate total coverage metrics
    total_instructions = total_metrics['instructions']['covered'] + total_metrics['instructions']['missed']
    total_branches = total_metrics['branches']['covered'] + total_metrics['branches']['missed']
    total_lines = total_metrics['lines']['covered'] + total_metrics['lines']['missed']
    
    if total_instructions > 0:
        metrics.instruction_coverage = (total_metrics['instructions']['covered'] / total_instructions) * 100
    if total_branches > 0:
        metrics.branch_coverage = (total_metrics['branches']['covered'] / total_branches) * 100
    if total_lines > 0:
        metrics.line_coverage = (total_metrics['lines']['covered'] / total_lines) * 100
    
    # Store raw numbers for overall coverage calculation
    metrics.total_instructions = total_instructions
    metrics.covered_instructions = total_metrics['instructions']['covered']
    metrics.total_branches = total_branches
    metrics.covered_branches = total_metrics['branches']['covered']
    metrics.total_lines = total_lines
    metrics.covered_lines = total_metrics['lines']['covered']
    
    return metrics

def calculate_overall_coverage(test_results):
    total_lines = 0
    covered_lines = 0
    total_instructions = 0
    covered_instructions = 0
    total_branches = 0
    covered_branches = 0
    
    for result in test_results:
        if result.coverage and result.status == "PASSED":
            total_lines += result.coverage.total_lines
            covered_lines += result.coverage.covered_lines
            total_instructions += result.coverage.total_instructions
            covered_instructions += result.coverage.covered_instructions
            total_branches += result.coverage.total_branches
            covered_branches += result.coverage.covered_branches
    
    metrics = {
        'overall_coverage': (covered_lines / total_lines * 100) if total_lines > 0 else 0,
        'instruction_coverage': (covered_instructions / total_instructions * 100) if total_instructions > 0 else 0,
        'branch_coverage': (covered_branches / total_branches * 100) if total_branches > 0 else 0,
        'line_coverage': (covered_lines / total_lines * 100) if total_lines > 0 else 0
    }
    
    return metrics

def cleanup():
    print(f"{Colors.BLUE}Cleaning up build and src directories...{Colors.NC}")
    for directory in ["build", "src", ".gradle", "gradle", ".ropeproject"]:
        shutil.rmtree(directory, ignore_errors=True)
    for file in ["gradlew", "gradlew.bat", BUILD_GRADLE_FILE]:
        if os.path.exists(file):
            os.remove(file)

def find_java_files(directory):
    java_files = []
    for file_path in Path(directory).rglob("*.java"):
        if "build" not in str(file_path) and ".gradle" not in str(file_path):
            java_files.append(str(file_path))
    return java_files

def find_test_files():
    return find_java_files(TEST_DIR)

def find_code_files():
    return find_java_files(CODE_DIR)

def check_test_convention(test_file):
    """Check if test file references Solution or Main"""
    with open(test_file, 'r') as f:
        content = f.read()
    return 'Solution' in content

def process_java_file(file_path, use_solution):
    with open(file_path, 'r') as f:
        content = f.read()
    
    target_class = "Solution" if use_solution else "Main"
    
    # Find all unique class names in the file
    class_pattern = r'(?:class|new|throws|extends|implements|\w+\s+)[\s\n]*(\w+)(?=[\s\n]*[{(\s])'
    class_names = set(re.findall(class_pattern, content))
    keywords = {'String', 'Integer', 'Boolean', 'Double', 'Float', 'List', 'Map', 'Set', 'Exception'}
    class_names = {name for name in class_names if name not in keywords}
    
    # Change protected/private to public
    content = re.sub(r'\b(private|protected)\s+static', 'public static', content)
    content = re.sub(r'\b(private|protected)\s+final\s+static', 'public static final', content)
    content = re.sub(r'\b(private|protected)\s+', 'public ', content)
    
    # Get the main class name and replace it
    main_class = re.search(r'public class (\w+)', content).group(1)
    content = re.sub(f'(?<!new )\\b{main_class}\\b', target_class, content)
    content = re.sub(f'new {main_class}\\(', f'new {target_class}(', content)
    
    return content

def setup_test_environment(code_file, test_files):
    # Create necessary directories
    os.makedirs(SRC_MAIN, exist_ok=True)
    os.makedirs(SRC_TEST, exist_ok=True)

    # Check test file convention
    uses_solution = check_test_convention(test_files[0])
    target_class = "Solution" if uses_solution else "Main"

    # Process and copy the main code file
    print(f"\nProcessing main code file: {code_file}")
    main_content = process_java_file(code_file, uses_solution)
    main_file_path = os.path.join(SRC_MAIN, f"{target_class}.java")
    with open(main_file_path, 'w') as f:
        f.write(main_content)

    # Copy test files with appropriate name
    for test_file in test_files:
        print(f"\nCopying test file: {test_file}")
        test_file_name = f"{target_class}Test.java"
        test_file_path = os.path.join(SRC_TEST, test_file_name)
        shutil.copy2(test_file, test_file_path)

def save_coverage_report(test_results):
    with open(COVERAGE_FILE, 'w') as f:
        f.write("Code Coverage Report\n")
        f.write("===================\n\n")
        f.write(f"Generated: {datetime.now()}\n\n")
        
        # Add overall coverage section
        overall_metrics = calculate_overall_coverage(test_results)
        f.write("Overall Coverage Metrics:\n")
        f.write("------------------------\n")
        f.write(f"Overall Coverage: {overall_metrics['overall_coverage']:.2f}%\n")
        f.write(f"Total Instruction Coverage: {overall_metrics['instruction_coverage']:.2f}%\n")
        f.write(f"Total Branch Coverage: {overall_metrics['branch_coverage']:.2f}%\n")
        f.write(f"Total Line Coverage: {overall_metrics['line_coverage']:.2f}%\n\n")
        
def run_tests():
    code_files = find_java_files(CODE_DIR)
    test_files = find_java_files(TEST_DIR)
    test_results = []

    if not code_files:
        print(f"{Colors.RED}No Java files found in {CODE_DIR} directory{Colors.NC}")
        return test_results

    if not test_files:
        print(f"{Colors.RED}No test files found in {TEST_DIR} directory{Colors.NC}")
        return test_results

    print(f"{Colors.GREEN}Found {len(code_files)} code files and {len(test_files)} test files{Colors.NC}")

    for code_file in code_files:
        print(f"\n{Colors.BLUE}Testing {code_file}{Colors.NC}")
        
        test_result = TestResult(code_file)
        
        cleanup()
        
        try:
            setup_test_environment(code_file, test_files)
            create_build_gradle()
            
            gradle_result = run_gradle(capture_output=True)
            test_result.output = gradle_result.stdout + gradle_result.stderr
            
            if 'compileJava FAILED' in test_result.output or 'error:' in test_result.output:
                test_result.status = "FAILED_TO_RUN"
                test_result.error = "Compilation failed"
            elif gradle_result.returncode == 0:
                test_result.status = "PASSED"
                # Parse coverage metrics after successful test run
                test_result.coverage = parse_jacoco_csv()
                print(f"{Colors.GREEN}Successfully tested {code_file}{Colors.NC}")
            else:
                test_result.status = "FAILED"
                test_result.error = f"Tests failed with return code: {gradle_result.returncode}"
                print(f"{Colors.RED}Tests failed for {code_file}{Colors.NC}")
                
        except Exception as e:
            test_result.status = "FAILED_TO_RUN"
            test_result.error = str(e)
            print(f"{Colors.YELLOW}Failed to run tests for {code_file}: {e}{Colors.NC}")
        
        save_test_result(test_result)
        test_results.append(test_result)
        cleanup()
    
    return test_results

def save_test_result(test_result):
    # Create results directory if it doesn't exist
    os.makedirs(RESULTS_DIR, exist_ok=True)
    
    # Save individual test result
    file_name = os.path.basename(test_result.file_name)
    result_file = os.path.join(RESULTS_DIR, f"{file_name.split('.java')[0]}.txt")
    
    with open(result_file, 'w') as f:
        f.write(f"Test Results for {file_name}\n")
        f.write(f"Timestamp: {test_result.timestamp}\n")
        f.write(f"Status: {test_result.status}\n")
        f.write("\nTest Output:\n")
        f.write(test_result.output)
        if test_result.error:
            f.write("\nErrors:\n")
            f.write(str(test_result.error))

def save_summary(test_results):
    summary_file = os.path.join(RESULTS_DIR, "summary.txt")
    
    def is_letter_file(filename):
        # Check if the filename is a single letter (case insensitive) followed by .java
        return bool(re.match(r'^[A-Za-z]\.java$', filename))
    
    def categorize_results(results):
        claude_tests = []
        llama_tests = []
        
        for result in results:
            file_name = os.path.basename(result.file_name)
            if is_letter_file(file_name):
                first_letter = file_name[0].upper()
                if 'A' <= first_letter <= 'E':
                    claude_tests.append(result)
                elif 'F' <= first_letter <= 'J':
                    llama_tests.append(result)
        
        return claude_tests, llama_tests
    
    def calculate_stats(tests):
        if not tests:
            return 0, 0, 0, 0, 0  # total, passed, failed, pass_percent, fail_percent
        
        total = len(tests)
        passed = sum(1 for r in tests if r.status == "PASSED")
        failed = sum(1 for r in tests if r.status == "FAILED")
        failed_to_run = sum(1 for r in tests if r.status == "FAILED_TO_RUN")
        
        pass_percent = (passed / total) * 100 if total > 0 else 0
        fail_percent = ((failed + failed_to_run) / total) * 100 if total > 0 else 0
        
        return total, passed, failed + failed_to_run, pass_percent, fail_percent
    
    claude_tests, llama_tests = categorize_results(test_results)
    
    with open(summary_file, 'w') as f:
        f.write("Test Execution Summary\n")
        f.write("=====================\n\n")
        f.write(f"Timestamp: {datetime.now()}\n\n")
        
        # Overall statistics (including all files)
        total = len(test_results)
        passed = sum(1 for r in test_results if r.status == "PASSED")
        failed = sum(1 for r in test_results if r.status == "FAILED")
        failed_to_run = sum(1 for r in test_results if r.status == "FAILED_TO_RUN")
        
        f.write("Overall Results (All Files):\n")
        f.write("---------------------------\n")
        f.write(f"Total files tested: {total}\n")
        f.write(f"Passed: {passed}\n")
        f.write(f"Failed: {failed}\n")
        f.write(f"Failed to Run: {failed_to_run}\n\n")
        
        # Model Comparison Statistics (letter files only)
        f.write("Model Comparison Statistics (Letter Files Only):\n")
        f.write("--------------------------------------------\n\n")
        
        # Claude model statistics (A-E)
        c_total, c_passed, c_failed, c_pass_pct, c_fail_pct = calculate_stats(claude_tests)
        f.write("Claude Model Tests (A-E):\n")
        f.write("------------------------\n")
        f.write(f"Total tests: {c_total}\n")
        f.write(f"Passed: {c_passed}\n")
        f.write(f"Failed/Failed to Run: {c_failed}\n")
        f.write(f"Pass Rate: {c_pass_pct:.2f}%\n")
        
        # Llama model statistics (F-J)
        l_total, l_passed, l_failed, l_pass_pct, l_fail_pct = calculate_stats(llama_tests)
        f.write("Llama Model Tests (F-J):\n")
        f.write("------------------------\n")
        f.write(f"Total tests: {l_total}\n")
        f.write(f"Passed: {l_passed}\n")
        f.write(f"Failed/Failed to Run: {l_failed}\n")
        f.write(f"Pass Rate: {l_pass_pct:.2f}%\n")
        
        f.write("Detailed Results:\n")
        f.write("----------------\n")
        for result in test_results:
            if result.status == "PASSED":
                status_icon = "✅"
            elif result.status == "FAILED":
                status_icon = "❌"
            else:  # FAILED_TO_RUN
                status_icon = "⚠️"
            f.write(f"{status_icon} {os.path.basename(result.file_name)}: {result.status}\n")

def create_build_gradle():
    gradle_content = """plugins {
    id 'java'
    id 'jacoco'
}

repositories {
    mavenCentral()
}

dependencies {
    testImplementation 'org.junit.jupiter:junit-jupiter-api:5.9.2'
    testRuntimeOnly 'org.junit.jupiter:junit-jupiter-engine:5.9.2'
}

test {
    useJUnitPlatform()
    finalizedBy jacocoTestReport

    testLogging {
        events 'passed', 'skipped', 'failed'
        showExceptions true
        showCauses true
        showStackTraces true
        exceptionFormat = 'full'
    }
}

jacocoTestReport {
    reports {
        csv.required = true
        html.required = true
    }
}
"""
    with open(BUILD_GRADLE_FILE, "w") as f:
        f.write(gradle_content)

def run_gradle(capture_output=True):
    subprocess.run(["gradle", "wrapper"], check=True, capture_output=capture_output)
    result = subprocess.run(["./gradlew", "test", "jacocoTestReport"], 
                          capture_output=capture_output, text=True)
    return result

def main():
    print(f"{Colors.GREEN}Starting Java code testing...{Colors.NC}")
    
    if not os.path.exists(CODE_DIR):
        print(f"{Colors.RED}Code directory '{CODE_DIR}' not found{Colors.NC}")
        return
    
    if not os.path.exists(TEST_DIR):
        print(f"{Colors.RED}Test directory '{TEST_DIR}' not found{Colors.NC}")
        return

    os.makedirs(RESULTS_DIR, exist_ok=True)

    test_results = run_tests()
    save_summary(test_results)
    save_coverage_report(test_results)

    print(f"{Colors.GREEN}All tests completed. Results and coverage report saved in {RESULTS_DIR} directory.{Colors.NC}")
    cleanup()

if __name__ == "__main__":
    main()