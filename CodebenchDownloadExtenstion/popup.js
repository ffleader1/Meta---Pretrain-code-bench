// At the beginning of the file, add this with the other event listeners
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['savePath', 'avoidSmartScreen'], (result) => {
        if (result.savePath) {
            document.getElementById('savePath').value = result.savePath;
        }
        if (result.avoidSmartScreen !== undefined) {
            document.getElementById('avoidSmartScreen').checked = result.avoidSmartScreen;
        }
    });

    // Add event listeners
    const checkbox = document.getElementById('avoidSmartScreen');
    checkbox.addEventListener('change', (e) => {
        chrome.storage.local.set({avoidSmartScreen: e.target.checked}); // Note: changed from e.target.value to e.target.checked
    });

    document.getElementById('savePath').addEventListener('change', (e) => {
        chrome.storage.local.set({savePath: e.target.value});
    });
});

// document.getElementById('copyFullTracePromptA').addEventListener('click', async (e) => {
//     await copyPromptToClipboard(1, false);
// })
//
// document.getElementById('copyFullTracePromptB').addEventListener('click', async (e) => {
//     await copyPromptToClipboard(2, false);
// })
//
// document.getElementById('copyFullTracePromptC').addEventListener('click', async (e) => {
//     await copyPromptToClipboard(3, false);
// })

document.getElementById('copyShortenTracePromptA').addEventListener('click', async (e) => {
    await copyPromptToClipboard(1, true);
})

document.getElementById('copyShortenTracePromptB').addEventListener('click', async (e) => {
    await copyPromptToClipboard(2, true);
})

document.getElementById('copyShortenTracePromptC').addEventListener('click', async (e) => {
    await copyPromptToClipboard(3, true);
})

document.getElementById('copyPromptWithSample').addEventListener('click', async (e) => {
    await copyPromptSampleToClipboard();
})

document.getElementById('copyIncorrectAnswer').addEventListener('click', async (e) => {
    await  copyAnswerPromptToClipboard(false);
})

document.getElementById('copyCorrectAnswer').addEventListener('click', async (e) => {
    await  copyAnswerPromptToClipboard(true);
})


document.getElementById('extractBtn').addEventListener('click', async function () {
    const status = document.getElementById('status');
    const savePath = document.getElementById('savePath').value;
    const avoidSmartScreen = document.getElementById('avoidSmartScreen').checked;

    if (!savePath) {
        status.innerHTML = 'Error: Please enter a save location';
        return;
    }

    status.innerHTML = 'Starting extraction...<br>';

    try {
        const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
        const results = await chrome.scripting.executeScript({
            target: {tabId: tab.id},
            function: extractCodeSnippets,
            args: [avoidSmartScreen]  // Pass the checkbox state as an argument
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
        status.innerHTML += `<br>Extension: ${result.ext}`;
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
                    '.java': 'text/x-java',
                    // // Add the alternative extensions
                    // '.jsx': 'application/javascript',
                    // '.pyx': 'text/x-python',
                    // '.cppx': 'text/x-c',
                    // '.javax': 'text/x-java'
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

function extractCodeSnippets(avoidSmartScreen) {
    try {

        function extractBetweenSeparators(inputString, separator = '-', minLength = 5) {
            if (!inputString || typeof inputString !== 'string') {
                return [];
            }

            // Create a regex pattern for finding long sequences of the separator
            const separatorPattern = new RegExp(`[${separator}]{${minLength},}`, 'g');

            // Split the string by the separator pattern
            const segments = inputString.split(separatorPattern);

            // Filter out empty segments and trim whitespace
            return segments
                .filter(segment => segment.trim().length > 0)
                .map(segment => segment.trim());
        }

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
                altExtension: '.jsx',  // Add this line
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
                altExtension: '.pyx',  // Add this line
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
                altExtension: '.cppx',  // Add this line
                defaultContent: "// Hello World\n#include <iostream>\n\nint main() {\n    std::cout << \"Hello, World!\" << std::endl;\n    return 0;\n}",
                commentPrefix: '//'
            },
            java: {
                name: 'java',
                regexes: [
                    /```java\n([\s\S]*?)\n```/g
                ],
                extension: '.java',
                altExtension: '.javax',  // Add this line
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


        const fileExtension = avoidSmartScreen ? language.altExtension : language.extension;


        responses.forEach((response, responseIndex) => {
            let matches = [];
            if (responseIndex !== 2) {
                const rawHtml = response.innerHTML;

                const decodeHTML = (html) => {
                    const txt = document.createElement('textarea');
                    txt.innerHTML = html;
                    return txt.value;
                };

                const decodedHtml = decodeHTML(rawHtml);

                // Try to find code blocks with language marker
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
            } else {
                // Handle O1 cuz o1 suck
                const copyButtons = response.querySelectorAll('button');

                for (const button of copyButtons) {
                    if (button.innerHTML.includes('copy') || button.getAttribute('text')) {
                        let txt = button.getAttribute('text');
                        if (txt) {
                            let sepStr = extractBetweenSeparators(txt);
                            if (sepStr.length > 0) {
                                sepStr.forEach((str, index) => {
                                    matches.push({
                                        content: str,
                                        isTyped: false
                                    });
                                })
                            } else {
                                matches.push({
                                    content: txt,
                                    isTyped: false
                                });
                            }
                        }


                    }
                }
            }


            const modelLetter = String.fromCharCode(65 + responseIndex);

            if (matches.length > 0) {
                // Find the match with the longest content
                const longestMatch = matches.reduce((longest, current) =>
                        current.content.length > longest.content.length ? current : longest
                    , matches[0]);

                snippets.push({
                    content: longestMatch.content,
                    fileName: `model_${modelLetter}${fileExtension}`
                });
            } else {
                // If no code found in this response, push empty content
                snippets.push({
                    content: language.defaultContent,
                    fileName: `model_${modelLetter}${fileExtension}`
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

        if (!avoidSmartScreen) {
            // Add default content only if we have exactly 3 snippets
            if (snippets.length === 3) {
                snippets.push({
                    content: language.defaultContent,
                    fileName: `model_0${fileExtension}`
                });
            }
        }

        return {
            taskId: taskId,
            language: programmingLanguage,
            ext: fileExtension,
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


async function extractPromptText() {
    try {
        const tabs = await new Promise((resolve, reject) => {
            chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                if (chrome.runtime.lastError)
                    reject(chrome.runtime.lastError);
                else
                    resolve(tabs);
            });
        });

        if (!tabs || !tabs[0]) {
            throw new Error("No active tab found");
        }

        const results = await new Promise((resolve, reject) => {
            chrome.scripting.executeScript({
                target: {tabId: tabs[0].id},
                function: function () {
                    try {
                        // Find all elements with IDs starting with "promptTurn-"
                        const promptElements = Array.from(document.querySelectorAll('[id^="promptTurn-"]'));
                        // Filter to only those that match "promptTurn-{number}" pattern
                        const matchingElements = promptElements.filter(el => el.id.match(/^promptTurn-\d+$/));

                        if (matchingElements.length === 0) {
                            return "No elements found with ID matching promptTurn-{number}";
                        }

                        if (matchingElements.length > 0) {
                            let element = matchingElements[0];
                            const copyButtons = element.querySelectorAll('button .anticon-copy');

                            if (copyButtons.length > 0) {
                                // Get the parent button of the first copy icon
                                const copyButton = copyButtons[0].closest('button');

                                if (copyButton && copyButton.getAttribute('text')) {
                                    // Extract the text attribute from the button
                                    return copyButton.getAttribute('text');
                                }
                            }

                            // Fallback to get text content if button not found
                            return element.textContent || "Found element but couldn't extract text";
                        }

                        return "No matching elements found";
                    } catch (error) {
                        return "Error in extractPromptText: " + error.message;
                    }
                }
            }, (results) => {
                if (chrome.runtime.lastError)
                    reject(chrome.runtime.lastError);
                else
                    resolve(results);
            });
        });

        return results[0].result;
    } catch (error) {
        console.error("Error in extractPromptText:", error);
        throw error;
    }
}

async function extractIncorrectAnswer(textToSearch) {
    try {
        const tabs = await new Promise((resolve, reject) => {
            chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                if (chrome.runtime.lastError)
                    reject(chrome.runtime.lastError);
                else
                    resolve(tabs);
            });
        });

        if (!tabs || !tabs[0]) {
            throw new Error("No active tab found");
        }

        const results = await new Promise((resolve, reject) => {
            chrome.scripting.executeScript({
                target: {tabId: tabs[0].id},
                args: [textToSearch], // Pass the argument here
                function: function(textToSearch) { // Receive it as a parameter here
                    try {
                        // Find the element with text matching textToSearch and red asterisk
                        const incorrectSolutionElement = Array.from(document.querySelectorAll('span'))
                            .find(element =>
                                element.textContent.includes(textToSearch) &&
                                element.innerHTML.includes('<span style="color: red;">')
                            );

                        if (!incorrectSolutionElement) {
                            return ['Error: Could not find element with text: ' + textToSearch];
                        }

                        // Find the correct parent container - looking for ant-space-vertical
                        const parentContainer = incorrectSolutionElement.closest('.ant-space-vertical');

                        if (!parentContainer) {
                            return ['Error: Could not find ant-space-vertical container'];
                        }

                        // Look for the button with copy icon and text attribute
                        const copyButtons = Array.from(parentContainer.querySelectorAll('button'))
                            .filter(button => {
                                return button.querySelector('.anticon-copy') !== null && button.hasAttribute('text');
                            });

                        if (copyButtons.length === 0) {
                            // If no copy buttons found with text attribute, try to get code directly
                            const codeElements = parentContainer.querySelectorAll('pre code');
                            if (codeElements.length > 0) {
                                return Array.from(codeElements).map(el => el.textContent);
                            }
                            return ['Error: Could not find copy buttons or code elements'];
                        }

                        // Extract the code from the text attribute
                        return copyButtons.map(button => button.getAttribute('text'));
                    } catch (error) {
                        return ['Error in extraction: ' + error.message];
                    }
                }
            }, (results) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    if (results && results[0] && results[0].result) {
                        resolve(results[0].result);
                    } else {
                        resolve(['No results found']);
                    }
                }
            });
        });

        return results;

    } catch (error) {
        console.error("Error in extractIncorrectAnswer:", error);
        return ['Error: ' + error.message];
    }
}

async function extractAnswer(traceNo) {
    try {
        const tabs = await new Promise((resolve, reject) => {
            chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                if (chrome.runtime.lastError)
                    reject(chrome.runtime.lastError);
                else
                    resolve(tabs);
            });
        });

        if (!tabs || !tabs[0]) {
            throw new Error("No active tab found");
        }

        const results = await new Promise((resolve, reject) => {
            chrome.scripting.executeScript({
                target: {tabId: tabs[0].id},
                function: function (traceNo) {
                    try {
                        const promptElements = document.querySelectorAll('[id^="promptResponse-"]');
                        const elementsArray = Array.from(promptElements);

                        if (elementsArray.length === 0) {
                            return "No elements found with ID matching responseEvaluation-{number}";
                        }

                        if (elementsArray.length >= traceNo) {
                            let element = elementsArray[traceNo - 1];
                            const copyButtons = element.querySelectorAll('button');

                            for (const button of copyButtons) {
                                if (button.innerHTML.includes('copy') || button.getAttribute('text')) {
                                    return button.getAttribute('text') || "Found button but no text attribute";
                                }
                            }

                            return element.textContent || "Found element but couldn't extract text";
                        } else {
                            return `Not enough elements found. Requested: ${traceNo}, Available: ${elementsArray.length}`;
                        }
                    } catch (error) {
                        return "Error in extractStackTrace: " + error.message;
                    }
                },
                args: [traceNo]
            }, (results) => {
                if (chrome.runtime.lastError)
                    reject(chrome.runtime.lastError);
                else
                    resolve(results);
            });
        });

        return results[0].result;
    } catch (error) {
        console.error("Error in extractAnswer:", error);
        throw error;
    }
}

async function extractStackTrace(traceNo) {
    try {
        const tabs = await new Promise((resolve, reject) => {
            chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                if (chrome.runtime.lastError)
                    reject(chrome.runtime.lastError);
                else
                    resolve(tabs);
            });
        });

        if (!tabs || !tabs[0]) {
            throw new Error("No active tab found");
        }

        const results = await new Promise((resolve, reject) => {
            chrome.scripting.executeScript({
                target: {tabId: tabs[0].id},
                function: function (traceNo) {
                    try {
                        const promptElements = document.querySelectorAll('[id^="responseEvaluation-"]');
                        const elementsArray = Array.from(promptElements);

                        if (elementsArray.length === 0) {
                            return "No elements found with ID matching responseEvaluation-{number}";
                        }

                        if (elementsArray.length >= traceNo) {
                            let element = elementsArray[traceNo - 1];
                            const containingDiv = element.closest('div');
                            const copyButtons = containingDiv.querySelectorAll('button');

                            for (const button of copyButtons) {
                                if (button.innerHTML.includes('copy') || button.getAttribute('text')) {
                                    return button.getAttribute('text') || "Found button but no text attribute";
                                }
                            }


                            return element.textContent || "Found element but couldn't extract text";
                        } else {
                            return `Not enough elements found. Requested: ${traceNo}, Available: ${elementsArray.length}`;
                        }
                    } catch (error) {
                        return "Error in extractStackTrace: " + error.message;
                    }
                },
                args: [traceNo]
            }, (results) => {
                if (chrome.runtime.lastError)
                    reject(chrome.runtime.lastError);
                else
                    resolve(results);
            });
        });

        return results[0].result;
    } catch (error) {
        console.error("Error in extractStackTrace:", error);
        throw error;
    }
}

async function copyAnswerPromptToClipboard(correct) {
    const promptText = await extractPromptText();

    let promptTextGen;

    if (!correct) {
        let incorrectBlock = await extractIncorrectAnswer("Incorrect Solution");
        let incorrectTrace = await extractIncorrectAnswer("Incorrect Solution Stack Trace");
        promptTextGen = promptV2(promptText, incorrectBlock[0], incorrectTrace[0])
    }else{
        let idealSolutionBlock = await extractIncorrectAnswer("Ideal Solution");
        let idealSolutionTrace = await extractIncorrectAnswer("Ideal Response Test Stack Trace");
        promptTextGen = promptV2(promptText, idealSolutionBlock[0], idealSolutionTrace[0])
    }

    if (promptTextGen) {
        await toClipboard(promptTextGen)
    } else {
        alert("No prompt text found to copy");
    }
}


async function copyPromptToClipboard(traceNo, shorten) {
    const promptText = await extractPromptText();
    const answer = await extractAnswer(traceNo)
    const traceText = await extractStackTrace(traceNo)

    let promptTextGen = promptV2(promptText, answer, traceText)

    if (promptTextGen) {
        await toClipboard(promptTextGen)
    } else {
        alert("No prompt text found to copy");
    }
}

async function toClipboard(promptTextGen) {
    navigator.clipboard.writeText(promptTextGen)
        .then(() => {
            console.log("Prompt text copied to clipboard");
            // alert("Prompt text copied to clipboard in way 1!");
        })
        .catch(err => {
            console.error("Failed to copy text: ", err);
            // Fallback method for clipboard copy
            const textarea = document.createElement('textarea');
            textarea.value = promptTextGen;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            //alert("Prompt text copied to clipboard in way 2!");
        });
}

async function copyPromptSampleToClipboard() {
    let promptText = ""
    try {
        promptText = await extractPromptText();
    } catch (e) {
        console.log(e)
    }
    let finalPromptText = "Your task is, from a given original text or llm prompt to do something in " +
        "a certain programming language, you need to create a doc " +
        "string that reflect the meaning of the given text and could help a llm model to generate the " +
        "complete class or function to be tested later. I do have some example for you. They are all in Python though, so for " +
        "other languages, do your best to stay reasonably similar in tone. Here are the examples: \n";

    finalPromptText += samplePrompt();
    finalPromptText += "\n\nAnd below is the original text that I want you to mimic to the above examples. Remember to " +
        "make the solution easily copyable. Also, since the function has to be testable, you are welcome to leave out any " +
        "ambiguous, redundant, meaningless or untestable detail in the final result. Must not use markdown-centric chars like" +
        "backtick, asterisk, hash mark or single quote, unless it is logically required and necessary for the result."
    finalPromptText += promptText;

    await toClipboard(finalPromptText)
}

function promptV2(promptText, answer, traceText) {
    let finalPromptText = "Your task is to look at the prompt and test result, and provide an overall justification " +
        "to each unit test in the form of: {test name} - (PASS/FAIL) + (in doing something/because of something)\n" +
        "For example, with 1157680/test.py::TestModularInverse::test_basic_cases PASSED, you can say Test basic cases - " +
        "PASSED in handling basic cases for Modular Inverse. Same thing, if test, fails, say FAILED because something " +
        "something. Accuracy justification should provide insight on how the model response could pass or fail with " +
        "logical code explanation, especially the case when it fails!\n You can get this info by looking at " +
        "both the answer and the trace." +
        "\nPut each test justification in a line, and MUST wrap the whole answer in a copiable block." +
        "\nQuote some code if you think it necessary.\n" +
        "MOST IMPORTANTLY: YOUR WORDS MUST SOUND LIKE A NICE, NATURAL AND PROFESSIONAL HUMAN, DOING REVIEWS ON YOUR OWN STUFF AND DEFINITIVE. DO NOT SOUND RIGID WITH A MACHINE GENERATED TEXT AND DO NOT USE" +
        "AMBIGUOUS KEYWORD LIKE PROBABLY, LIKELY...\n"

    finalPromptText += "OK, and here is the prompt, the answer and the stack trace. REMEMBER TO WRAP IT IN A COPYABLE CODE BLOCK:\n" +
        promptText + "\n\n--------------------------" + answer + "\n\n--------------------------" + traceText
    return finalPromptText;
}

function prompt(promptText, traceText, shorten) {
    let finalPromptText = "Your task is to return  up to 3 sentences, providing overall how good a langauge model provided a code, by looking" +
        "through the original prompt and the unit test stack trace. You can look at the prompt condition, the stack trace," +
        "and provide your own conclusion. Wrap it in a COPYABLE makrdown block.\n";

    if (!shorten) {
        finalPromptText += sample();
    }

    finalPromptText += "OK, and here is the prompt and the stack trace. REMEMBER TO WRAP IT IN A COPYABLE CODE BLOCK:\n" +
        promptText + "\n" + traceText

    return finalPromptText;

}

function samplePrompt() {
    return "\"def get_linux_file_perm_from_octet(user: int, group: int, others: int) -> str:\n" +
        " \"\"\"\"\"\"\n" +
        " Converts three numeric octets (0-7) representing user, group, and others permissions to a Linux file permission string.\n" +
        "\n" +
        " Args:\n" +
        " user (int): The numeric octet representing user permissions (0-7).\n" +
        " group (int): The numeric octet representing group permissions (0-7).\n" +
        " others (int): The numeric octet representing others permissions (0-7).\n" +
        "\n" +
        " Returns:\n" +
        " str: The Linux file permission string (e.g., 'rwxr-xr--').\n" +
        "\n" +
        " Examples:\n" +
        " >>> GetLinuxFilePermFromOctet(7, 5, 4)\n" +
        " 'rwxr-xr--'\n" +
        "\n" +
        " >>> GetLinuxFilePermFromOctet(4, 4, 4)\n" +
        " 'r--r--r--'\n" +
        " \"\"\"\"\"\"\"\n" +
        "\"#include <iostream>\n" +
        "#include <string>\n" +
        "#include <unordered_map>\n" +
        "\n" +
        "using namespace std;\n" +
        "\n" +
        "/**\n" +
        " * Given a positive integer n, determine if it is a mirror number.\n" +
        " *\n" +
        " * A mirror number is a number where if you replace certain digits with their mirror image,\n" +
        " * you get the same number when viewed upside down.\n" +
        " * Valid mirror pairs are: 0->0, 1->1, 6->9, 8->8, 9->6\n" +
        " * \n" +
        " * @param n - Input number (1 ≤ n ≤ 10000)\n" +
        " * @return True if n is a mirror number, false otherwise\n" +
        " *\n" +
        " * Example:\n" +
        " * isMirrorNumber(619)\n" +
        " * // result is True, because when turned upside down 619 becomes 916, which is valid\n" +
        " *\n" +
        " * isMirrorNumber(123)\n" +
        " * // result if False\n" +
        " */\n" +
        "bool isMirrorNumber(int n) {}\"\n" +
        "\"def give_sweets(happiness: List[List[int]]) -> int:\n" +
        " \"\"\"\"\"\"\n" +
        " Implements a distributing sweets algorithm in a neighborhood with M different types of sweets and N houses.\n" +
        " The algorithm follows these rules:\n" +
        "\n" +
        " 1. Gives exactly one sweet to each house\n" +
        " 2. Adjacent houses cannot receive the same type of sweet (e.g., if house 0 gets sweet type 2, house 1 cannot get sweet type 2)\n" +
        " 3. The goal is to minimize the total happiness (sum of happiness values) across all houses\n" +
        "\n" +
        " Args:\n" +
        " happiness (List[List[int]]): A MxN matrix where happiness[i][j] indicates the happiness of house i after getting sweet type j\n" +
        "\n" +
        " Returns:\n" +
        " int: The minimum possible total happiness achievable. If the matrix is empty, returns 0.\n" +
        "\n" +
        " Raises:\n" +
        " ValueError: If any happiness value is negative or the matrix has an incorrect format.\n" +
        "\n" +
        " Examples:\n" +
        "\n" +
        " >>> give_sweets([[1, 5, 3], [2, 9, 4]])\n" +
        " 5\n" +
        " Explanation: Give sweet type 0 to house 0 (happiness 1) and sweet type 2 to house 1 (happiness 4). Total: 1+4=5.\n" +
        "\n" +
        " >>> give_sweets([[3, 1, 2]])\n" +
        " 1\n" +
        " Explanation: Give sweet type 1 to house 0 (happiness 1). Total: 1.\n" +
        " \"\"\"\"\"\"\"\n" +
        "\"def count_good_permutations(s: str) -> int:\n" +
        " \"\"\"\"\"\"\n" +
        " Counts the number of distinct permutations of s optimally that satisfy the \"\"good\"\" condition.\n" +
        "\n" +
        " A permutation is \"\"good\"\" if:\n" +
        " - Characters at even indices (0-based) are added to the sum (ASCII value).\n" +
        " - Characters at odd indices are subtracted from the sum.\n" +
        " - The final computed sum is 0.\n" +
        "\n" +
        " Note:\n" +
        " - Duplicate characters in the string should be handled such that permutations that are identical \n" +
        " when considering character positions are counted only once. In other words, even if characters \n" +
        " appear multiple times, only distinct arrangements are considered.\n" +
        " - The input string's length can be up to 10^5 characters, so the solution must be efficient \n" +
        " (ideally linear or quasi-linear in time complexity relative to the length of the string).\n" +
        "\n" +
        " Args:\n" +
        " s (str): A non-empty string of lowercase English letters.\n" +
        "\n" +
        " Returns:\n" +
        " int: The number of good permutations modulo 10^9 + 7.\n" +
        "\n" +
        " Raises:\n" +
        " ValueError(\"\"Input must be a non-empty string of lowercase English letters.\"\"): If the input is not a valid lowercase string.\n" +
        "\n" +
        " Examples:\n" +
        " >>> count_good_permutations(\"\"abc\"\")\n" +
        " 2\n" +
        "\n" +
        " >>> count_good_permutations(\"\"aabb\"\")\n" +
        " 4\n" +
        " \"\"\"\"\"\"\""
}

function sample() {
    return "I can give you some example like:\n" +
        "EXAMPLE 1:\n" +
        "Prompt and stack trace: \n" +
        "-------------------------------------------------------------------\n" +
        "/**\n" +
        " * Compresses IoT sensor data using Burrows-Wheeler Transform algorithm\n" +
        " * \n" +
        " * @typedef {Object} SensorReading\n" +
        " * @property {string} type - Type of sensor (e.g., \"temperature\", \"humidity\", \"pressure\")\n" +
        " * @property {number} value - The numerical reading from the sensor\n" +
        " * @property {string} unit - Unit of measurement (e.g., \"C\", \"%\", \"hPa\")\n" +
        " * \n" +
        " * @typedef {Object} SensorData\n" +
        " * @property {string} deviceId - Unique identifier for the sensor device\n" +
        " * @property {number} timestamp - Unix timestamp of when readings were collected\n" +
        " * @property {SensorReading[]} readings - Array of sensor readings\n" +
        " * \n" +
        " * @typedef {Object} CompressedResult\n" +
        " * @property {string} deviceId - Original device identifier\n" +
        " * @property {number} timestamp - Original timestamp\n" +
        " * @property {string} compressedData - BWT and RLE compressed data string\n" +
        " * @property {number} bwtIndex - Index needed for BWT decompression\n" +
        " * @property {number} originalSize - Size in bytes of the original data\n" +
        " * @property {number} compressedSize - Size in bytes of the compressed data\n" +
        " * @property {string} compressionRatio - Ratio of compressed to original size as percentage\n" +
        " * @property {string[]} sensorTypes - Types of sensors in the original data\n" +
        " * @property {number} readingCount - Number of readings in the original data\n" +
        " * \n" +
        " * Implements a Burrows-Wheeler Transform with Run-Length Encoding for efficient\n" +
        " * compression of sensor data. Optimizes for time-series data patterns common in IoT sensors.\n" +
        " * Complete the function to handle real-time sensor data compression efficiently.\n" +
        " * \n" +
        " * @param {SensorData} sensorData - Object containing sensor device data and readings\n" +
        " * @returns {CompressedResult} Compressed data and metadata\n" +
        " * \n" +
        " * @throws {Error} \"Invalid sensor data format\" - If input is missing required properties\n" +
        " * @throws {TypeError} \"Invalid sensor reading value\" - If readings contain non-numeric values\n" +
        " * @throws {Error} \"Empty readings array\" - If no sensor readings are provided\n" +
        " * \n" +
        " * Remember to wrap the final code in a code block\n" +
        " */" +
        "```bash\n" +
        "✓ compresses valid sensor data and returns correct result structure\n" +
        "✓ achieves better compression with repeating data patterns\n" +
        "✓ throws error for invalid sensor data format\n" +
        "✓ throws error for invalid sensor reading values\n" +
        "✓ throws error for empty readings array\n" +
        "✓ produces consistent results for identical inputs\n" +
        "✓ calculates compression ratio correctly\n" +
        "✓ handles large datasets without excessive runtime\n" +
        "✓ correctly identifies all sensor types in the data\n" +
        "✓ handles single reading correctly\n" +
        "✓ handles extremely large sensor values\n" +
        "```\n" +
        "Good Answer: \n" +
        "-------------------------------------------------------------------\n" +
        "The provided code satisfied the prompt requirement of providing a working Burrows-Wheeler implementation, optimize to" +
        "handle time-series data pattern, as well as handing multiple edge cases regarding in valid sensor data format or" +
        "invalid sensor reading values.\n" +
        "\n\n\n" +
        "EXAMPLE 2:\n" +
        "Prompt and stack trace: \n" +
        "-------------------------------------------------------------------\n" +
        "def calculate_modular_inverse(a: int, m: int) -> tuple[int, list[int]]:\n" +
        "    \"\"\"\n" +
        "    Task: Generate a Python implementation for modular multiplicative inverse using Extended Euclidean Algorithm\n" +
        "    that returns both the inverse and the key intermediate values.\n" +
        "\n" +
        "    Requirements:\n" +
        "    - Main entry point function should calculate modular inverse\n" +
        "    - Must return a tuple containing:\n" +
        "        * The modular inverse as first element\n" +
        "        * List of intermediate remainders from the Extended Euclidean steps\n" +
        "    - Support functions should handle Extended Euclidean Algorithm computation\n" +
        "    - Must optimize for space and time complexity\n" +
        "    - List of intermediate remainders must start with larger input number and remain in descending order\n" +
        "    \n" +
        "    Edge cases to handle:\n" +
        "    - Non-coprime inputs \n" +
        "    - Zero input\n" +
        "    - Negative numbers (normalize and handle signs for both input and modulus, even negative moduli)\n" +
        "    - Large numbers (implement overflow protection)\n" +
        "    \n" +
        "    Additional notes:\n" +
        "    - Track key intermediate values for debugging\n" +
        "    - Verify final result satisfies modular inverse property\n" +
        "    - Return value must be smallest positive representation\n" +
        "    - Wrap the result in a code block\n" +
        "    \"\"\"" +

        "============================= test session starts ==============================\n" +
        "platform darwin -- Python 3.14.0a1, pytest-8.3.4, pluggy-1.5.0 -- /Library/Frameworks/Python.framework/Versions/3.14/bin/python3.14\n" +
        "cachedir: .pytest_cache\n" +
        "rootdir: /Users/cuongnguyen/Downloads/metacodebench/python\n" +
        "collecting ... collected 9 items\n" +
        "\n" +
        "1157680/test.py::TestModularInverse::test_basic_cases PASSED             [ 11%]\n" +
        "1157680/test.py::TestModularInverse::test_coprime_numbers PASSED         [ 22%]\n" +
        "1157680/test.py::TestModularInverse::test_edge_modulo_one PASSED         [ 33%]\n" +
        "1157680/test.py::TestModularInverse::test_intermediate_values FAILED     [ 44%]\n" +
        "1157680/test.py::TestModularInverse::test_large_numbers PASSED           [ 55%]\n" +
        "1157680/test.py::TestModularInverse::test_negative_numbers FAILED        [ 66%]\n" +
        "1157680/test.py::TestModularInverse::test_non_coprime_inputs PASSED      [ 77%]\n" +
        "1157680/test.py::TestModularInverse::test_result_range PASSED            [ 88%]\n" +
        "1157680/test.py::TestModularInverse::test_zero_input PASSED              [100%]\n" +
        "\n" +
        "=================================== FAILURES ===================================\n" +
        "_________________ TestModularInverse.test_intermediate_values __________________\n" +
        "\n" +
        "self = <test.TestModularInverse testMethod=test_intermediate_values>\n" +
        "\n" +
        "    def test_intermediate_values(self):\n" +
        "       \"\"\"Test the intermediate steps returned by the algorithm\"\"\"\n" +
        "       result, steps = calculate_modular_inverse(3, 7)\n" +
        "    \n" +
        "       # Verify steps is a non-empty list\n" +
        "       self.assertIsInstance(steps, list)\n" +
        "       self.assertGreater(len(steps), 0)\n" +
        "    \n" +
        "       # Verify all steps are integers\n" +
        "       self.assertTrue(all(isinstance(x, int) for x in steps))\n" +
        "    \n" +
        "       # First step should be the larger input number\n" +
        ">      self.assertEqual(steps[0], max(3, 7))\n" +
        "E      AssertionError: 3 != 7\n" +
        "\n" +
        "1157680/test.py:75: AssertionError\n" +
        "___________________ TestModularInverse.test_negative_numbers ___________________\n" +
        "\n" +
        "self = <test.TestModularInverse testMethod=test_negative_numbers>\n" +
        "\n" +
        "    def test_negative_numbers(self):\n" +
        "       \"\"\"Test handling of negative inputs\"\"\"\n" +
        "       # Test negative first parameter\n" +
        "       result, steps = calculate_modular_inverse(-3, 7)\n" +
        "       self.assertEqual(result, 2)  # Should normalize to positive result\n" +
        "    \n" +
        "       # Test both negative parameters\n" +
        ">      result, steps = calculate_modular_inverse(-3, -7)\n" +
        "\n" +
        "1157680/test.py:36: \n" +
        "_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ \n" +
        "\n" +
        "a = -3, m = 7\n" +
        "\n" +
        "    def calculate_modular_inverse(a: int, m: int) -> tuple[int, list[int]]:\n" +
        "        \"\"\"\n" +
        "        Calculate the modular multiplicative inverse of a modulo m using the Extended Euclidean Algorithm.\n" +
        "        Returns a tuple containing the modular inverse and a list of intermediate remainders.\n" +
        "        \"\"\"\n" +
        "        # Normalize inputs to handle negative numbers\n" +
        "        a = a % m\n" +
        "        m = abs(m)  # Modulus must be positive\n" +
        "    \n" +
        "        # Handle edge cases\n" +
        "        if a == 0:\n" +
        "            raise ValueError(\"Modular inverse does not exist for zero input.\")\n" +
        "        if m == 0:\n" +
        "            raise ValueError(\"Modulus cannot be zero.\")\n" +
        "    \n" +
        "        # Compute gcd and coefficients\n" +
        "        gcd, x, _, remainders = extended_gcd(a, m)\n" +
        "    \n" +
        "        # Check if a and m are coprime\n" +
        "        if gcd != 1:\n" +
        ">           raise ValueError(f\"Modular inverse does not exist for non-coprime inputs: gcd({a}, {m}) = {gcd}.\")\n" +
        "E           ValueError: Modular inverse does not exist for non-coprime inputs: gcd(-3, 7) = -1.\n" +
        "\n" +
        "1157680/solution.py:42: ValueError\n" +
        "=========================== short test summary info ============================\n" +
        "FAILED 1157680/test.py::TestModularInverse::test_intermediate_values - Assert...\n" +
        "FAILED 1157680/test.py::TestModularInverse::test_negative_numbers - ValueErro...\n" +
        "========================= 2 failed, 7 passed in 0.02s ==========================\n" +
        "Good Answer: \n" +
        "-------------------------------------------------------------------\n" +
        "The provided code satisfied some of the the prompt requirements, like handling basic case, co-prime input and zero input. " +
        "However, it failed to handle test cases regarding negative numbers and intermediate values. So overall, unit test is not passed" +
        "-------------------------------------------------------------------\n"
}
