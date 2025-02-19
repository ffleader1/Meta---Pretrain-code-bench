chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background script received message:', request);

    if (request.action === 'downloadFile') {
        // Create a fixed subfolder structure in Downloads
        const fullPath = `${request.fileSaveDir}/${request.filename}`;

        // Check if filename contains "model_0"
        if (request.filename.includes('model_0')) {
            // Check if file exists using chrome.downloads.search
            chrome.downloads.search({
                query: [fullPath],
                exists: true
            }, (results) => {
                if (results && results.length > 0) {
                    console.log('model_0 file already exists, skipping download');
                    sendResponse({
                        error: 'File with model_0 already exists, download prevented',
                        exists: true
                    });

                } else {
                    // File doesn't exist, proceed with download
                    initiateDownload();
                }
            });
        } else {
            // Not a model_0 file, proceed with download
            initiateDownload();
        }

        function initiateDownload() {
            console.log('Downloading to:', fullPath);
            console.log('MIME Type:', request.mimeType);

            chrome.downloads.download({
                url: request.url,
                filename: fullPath,
                conflictAction: 'overwrite',
                saveAs: false,
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error('Download error:', chrome.runtime.lastError);
                    sendResponse({ error: chrome.runtime.lastError.message });
                } else {
                    console.log('Download started:', downloadId);
                    sendResponse({ success: true, downloadId: downloadId });
                }
            });
        }

        return true; // Keep message channel open for async response
    }
});