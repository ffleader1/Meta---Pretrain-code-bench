document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['savePath'], (result) => {
        if (result.savePath) {
            document.getElementById('savePath').value = result.savePath;
        }
    });
});

document.getElementById('savePath').addEventListener('change', (e) => {
    chrome.storage.local.set({savePath: e.target.value});
});

document.getElementById('extractBtn').addEventListener('click', async function () {
    const status = document.getElementById('status');
    const savePath = document.getElementById('savePath').value;

    if (!savePath) {
        status.innerHTML = 'Error: Please enter a save location';
        return;
    }

    status.innerHTML = 'Starting extraction...<br>';

    try {
        const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
        const results = await chrome.scripting.executeScript({
            target: {tabId: tab.id},
            function: extractCodeSnippets
        });

        const result = results[0].result;
        if (result.error) {
            status.innerHTML += `<br>Error: ${result.error}`;
            return;
        }

        if (!result.taskId) {
            status.innerHTML += `<br>Error: Could not find task ID in the URL`;
            return;
        }

        status.innerHTML += `<br>Found ${result.responsesFound} responses`;
        status.innerHTML += `<br>Found ${result.codeBlocksFound} code blocks`;
        status.innerHTML += `<br>Task ID: ${result.taskId}`;

        if (result.codeBlocksFound > 0) {
            const save_path_with_language = `${savePath}/${result.language}`;
            status.innerHTML += `<br>Saving to: ${save_path_with_language}/${result.taskId}`;

            // Create and save .env file first
            const envContent = `WORKING_TASK=${result.taskId}`;
            const envBlob = new Blob([envContent], {
                type: 'text/plain',
                endings: 'native'
            });
            const envUrl = URL.createObjectURL(envBlob);

            try {
                await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage({
                        action: 'downloadFile',
                        url: envUrl,
                        fileSaveDir: `${save_path_with_language}`,
                        taskId: result.taskId,
                        filename: 'env'
                    }, response => {
                        if (response?.error) {
                            reject(new Error(response.error));
                        } else {
                            resolve(response);
                        }
                    });
                });
                status.innerHTML += `<br>Created: .env`;
            } catch (err) {
                status.innerHTML += `<br>Error saving .env: ${err.message}`;
            } finally {
                URL.revokeObjectURL(envUrl);
            }

            // Save code snippets
            for (const snippet of result.snippets) {
                const mimeTypes = {
                    '.js': 'application/javascript',
                    '.py': 'text/x-python',
                    '.cpp': 'text/x-c',
                    '.java': 'text/x-java'
                };

                const extension = snippet.fileName.split('.').pop();
                const mimeType = mimeTypes['.' + extension] || 'text/plain';

                const blob = new Blob([snippet.content], {
                    type: mimeType,
                    endings: 'native'
                });
                const url = URL.createObjectURL(blob);

                try {
                    await new Promise((resolve, reject) => {
                        chrome.runtime.sendMessage({
                            action: 'downloadFile',
                            url: url,
                            fileSaveDir: `${save_path_with_language}/${result.taskId}`,
                            taskId: result.taskId,
                            filename: snippet.fileName
                        }, response => {
                            if (response?.error) {
                                reject(new Error(response.error));
                            } else {
                                resolve(response);
                            }
                        });
                    });
                    status.innerHTML += `<br>Created: ${snippet.fileName}`;
                } catch (err) {
                    status.innerHTML += `<br>Error saving ${snippet.fileName}: ${err.message}`;
                } finally {
                    URL.revokeObjectURL(url);
                }
            }
        }
    } catch (err) {
        status.innerHTML += `<br>Error: ${err.message}`;
    }
});

function extractCodeSnippets() {
    try {
        // Language definitions
        const languages = {
            javascript: {
                name: 'javascript',
                regexes: [
                    /```Javascript\n([\s\S]*?)\n```/g,
                    /```Js\n([\s\S]*?)\n```/g,
                    /```javascript\n([\s\S]*?)\n```/g,
                    /```js\n([\s\S]*?)\n```/g,
                    /```node\n([\s\S]*?)\n```/g
                ],
                extension: '.js',
                defaultContent: "// Hello World\nconsole.log(\"Hello, World!\");",
                commentPrefix: '//'
            },
            python: {
                name: 'python',
                regexes: [
                    /```Python\n([\s\S]*?)\n```/g,
                    /```python\n([\s\S]*?)\n```/g,
                    /```py\n([\s\S]*?)\n```/g
                ],
                extension: '.py',
                defaultContent: "# Hello World\nprint(\"Hello, World!\")",
                commentPrefix: '#'
            },
            cpp: {
                name: 'cpp',
                regexes: [
                    /```cpp\n([\s\S]*?)\n```/g,
                    /```c\+\+\n([\s\S]*?)\n```/g
                ],
                extension: '.cpp',
                defaultContent: "// Hello World\n#include <iostream>\n\nint main() {\n    std::cout << \"Hello, World!\" << std::endl;\n    return 0;\n}",
                commentPrefix: '//'
            },
            java: {
                name: 'java',
                regexes: [
                    /```java\n([\s\S]*?)\n```/g
                ],
                extension: '.java',
                defaultContent: "// Hello World\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println(\"Hello, World!\");\n    }\n}",
                commentPrefix: '//'
            }
        };


        // Extract task ID from URL
        const taskId = (() => {
            console.log("Current URL:", window.location.href);
            // First try from URL
            const urlMatch = window.location.href.match(/conversations\/(\d+)/);
            if (urlMatch) {
                console.log("Found task ID in URL:", urlMatch[1]);
                return urlMatch[1];
            }

            // If not in URL, try searching in page content
            console.log("Searching in page content...");
            const html = document.documentElement.innerHTML;
            const match = html.match(/conversations\/(\d+)/);
            console.log("Match result:", match);
            return match ? match[1] : null;
        })();

        if (!taskId) {
            console.error("No task ID found");
            return {
                error: 'Could not find task ID in the page',
                responsesFound: 0,
                codeBlocksFound: 0
            };
        }

        // Detect programming language from the page
        const detectLanguage = () => {
            const elements = document.querySelectorAll('span.ant-typography');
            console.log('Found typography elements:', elements.length);

            // Create variations of the language identifier
            const identifiers = [
                'programming language:',
                'programming_language:',
                'programminglanguage:',
            ];

            for (const el of elements) {
                console.log('Checking element:', el.textContent);

                // Normalize the text: convert to lowercase, remove extra spaces
                const normalizedText = el.textContent.toLowerCase().trim();

                // Check if any identifier matches
                const matches = identifiers.some(identifier =>
                    normalizedText.includes(identifier) ||
                    // Also check by replacing spaces with underscores
                    normalizedText.includes(identifier.replace(/ /g, '_'))
                );

                if (matches) {
                    // Get the next sibling which should contain the language
                    const langSpan = el.parentElement.querySelector('span[style="white-space: pre-wrap;"]');
                    if (langSpan) {
                        const langText = langSpan.textContent.trim().toLowerCase();
                        console.log('Found language text:', langText);

                        if (langText.includes('python')) return 'python';
                        if (langText.includes('java') && !langText.includes('javascript')) return 'java';
                        if (langText.includes('c++') || langText.includes('cpp')) return 'cpp';
                        if (langText.includes('javascript') || langText === 'js') return 'javascript';
                    }
                }
            }

            console.log('No language found, defaulting to python');
            return 'python';
        };

        const programmingLanguage = detectLanguage();
        const language = languages[programmingLanguage];
        console.log('Detected language:', programmingLanguage);

        const responses = document.querySelectorAll('[id^="promptResponse-"]');
        console.log('Found responses:', responses.length);

        if (responses.length === 0) {
            return {
                error: 'No code blocks found on this page',
                responsesFound: 0,
                codeBlocksFound: 0
            };
        }

        let totalCodeBlocks = 0;
        let snippets = [];
        let fileCounter = 0;


        responses.forEach((response, responseIndex) => {
            const rawHtml = response.innerHTML;

            const decodeHTML = (html) => {
                const txt = document.createElement('textarea');
                txt.innerHTML = html;
                return txt.value;
            };

            const decodedHtml = decodeHTML(rawHtml);

            // Try to find code blocks with language marker
            let matches = [];
            for (const regex of language.regexes) {
                const currentMatches = [...decodedHtml.matchAll(regex)].map(m => ({
                    content: m[1],
                    isTyped: true
                }));
                matches = matches.concat(currentMatches);
            }

            // If no typed blocks found, try generic blocks
            if (matches.length === 0) {
                const genericRegex = /```\n([\s\S]*?)\n```/g;
                matches = [...decodedHtml.matchAll(genericRegex)].map(m => ({
                    content: m[1],
                    isTyped: false
                }));
            }

            // Take only the last match from this response
            const modelLetter = String.fromCharCode(65 + responseIndex);
            if (matches.length > 0) {
                const lastMatch = matches[matches.length - 1];
                snippets.push({
                    content: lastMatch.content,
                    fileName: `model_${modelLetter}${language.extension}`
                });
            } else {
                // If no code found in this response, push empty content
                snippets.push({
                    content: '',
                    fileName: `model_${modelLetter}${language.extension}`
                });
            }

            totalCodeBlocks += matches.length;
        });

        // // After processing all responses, check if we have enough matches
        // if (snippets.length < 3) {
        //     alert(`Not enough ${language.name} code blocks found. Try explicitly tell the models to wrap the final answer in a code block.`);
        //     // Exit early if we don't have enough matches
        // }

        // Keep only the first 3 snippets if we have more
        if (snippets.length > 3) {
            snippets = snippets.slice(0, 3);
        }

        // Add default content only if we have exactly 3 snippets
        if (snippets.length === 3) {
            snippets.push({
                content: language.defaultContent,
                fileName: `model_0${language.extension}`
            });
        }

        return {
            taskId: taskId,
            language: programmingLanguage,
            responsesFound: responses.length,
            codeBlocksFound: totalCodeBlocks,
            snippets: snippets
        };

    } catch (err) {
        console.error('Extraction error:', err);
        return {
            error: err.message,
            responsesFound: 0,
            codeBlocksFound: 0
        };
    }
}
