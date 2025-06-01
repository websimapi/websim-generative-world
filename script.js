import { gsap } from 'gsap';

const gameCanvas = document.getElementById('game-canvas');
const messageLog = document.getElementById('message-log');
const playersListDiv = document.getElementById('players-list');
const loadingOverlay = document.getElementById('loading-overlay');
const metadataCommentsListDiv = document.getElementById('metadata-comments-list');
const refreshCommentsButton = document.getElementById('refresh-comments-btn');
const assetLibraryListDiv = document.getElementById('asset-library-list');

const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 600;
const ENTITY_DISPLAY_SIZE = 80;

const room = new WebsimSocket();
const assetCollection = room.collection('asset_v1'); // For storing generated assets

let metadataComments = []; // Stores our augmented comment objects
let knownCommentIds = new Set(); // To track processed API comment IDs
let currentProjectId = null;
const POLLING_INTERVAL = 10000; // 10 seconds

async function init() {
    setLoading(true, "Initializing...");
    try {
        await room.initialize();

        if (!room.roomState || typeof room.roomState.entities === 'undefined') {
            await room.updateRoomState({
                entities: {},
            });
        }
        
        const myPeerInfo = room.peers[room.clientId];
        if (myPeerInfo) {
             room.updatePresence({
                id: room.clientId,
                username: myPeerInfo.username,
                avatarUrl: myPeerInfo.avatarUrl,
            });
        }

        room.subscribeRoomState(handleRoomStateUpdate);
        room.subscribePresence(handlePresenceUpdate);
        assetCollection.subscribe(renderAssetLibrary); // Subscribe to asset changes
        
        handleRoomStateUpdate(room.roomState);
        handlePresenceUpdate(room.presence);
        renderAssetLibrary(assetCollection.getList()); // Initial render of asset library

        const project = await window.websim.getCurrentProject();
        if (project && project.id) {
            currentProjectId = project.id;
            addLogMessage("System", `Connected to project: ${project.title || project.id}`);
            await fetchInitialComments();
            setInterval(fetchNewComments, POLLING_INTERVAL);
        } else {
            addLogMessage("Error", "Could not get current project ID. Comments will not be loaded.");
            metadataCommentsListDiv.innerHTML = '<p>Error: Could not load project comments.</p>';
        }

        refreshCommentsButton.addEventListener('click', () => {
            addLogMessage("System", "Manually refreshing comments...");
            fetchInitialComments(true); // true to force a full refresh feel
        });
        
        // Setup drag and drop for the game canvas
        gameCanvas.addEventListener('dragover', handleDragOverCanvas);
        gameCanvas.addEventListener('drop', handleDropOnCanvas);
        gameCanvas.addEventListener('dragenter', () => gameCanvas.classList.add('drag-over'));
        gameCanvas.addEventListener('dragleave', () => gameCanvas.classList.remove('drag-over'));


        addLogMessage("System", "Game initialized. Process a comment or drag an asset to the canvas.");

    } catch (error) {
        console.error("Initialization failed:", error);
        addLogMessage("Error", `Initialization failed: ${error.message}`);
         metadataCommentsListDiv.innerHTML = `<p>Initialization error: ${error.message}</p>`;
    } finally {
        setLoading(false);
    }
}

function setLoading(isLoading, text = "Generating...") {
    if (isLoading) {
        loadingOverlay.classList.remove('hidden');
        loadingOverlay.querySelector('p').textContent = text;
    } else {
        loadingOverlay.classList.add('hidden');
    }
}

function handleRoomStateUpdate(currentRoomState) {
    if (currentRoomState && currentRoomState.entities) {
        renderEntities(currentRoomState.entities);
    }
}

function handlePresenceUpdate(currentPresence) {
    if (currentPresence) {
        renderPlayers(currentPresence);
    }
}

function renderEntities(entities) {
    const existingEntityElements = Array.from(gameCanvas.querySelectorAll('.game-entity'));
    existingEntityElements.forEach(el => {
        if (!entities[el.id]) { 
            gsap.to(el, { opacity: 0, scale: 0.5, duration: 0.3, onComplete: () => el.remove() });
        }
    });

    for (const entityId in entities) {
        const entity = entities[entityId];
        if (!entity) continue;

        let entityElement = gameCanvas.querySelector(`#${entity.id}`);
        if (!entityElement) { 
            entityElement = document.createElementNS("http://www.w3.org/2000/svg", "image");
            entityElement.setAttribute('id', entity.id);
            entityElement.setAttribute('class', 'game-entity');
            
            const titleEl = document.createElementNS("http://www.w3.org/2000/svg", "title");
            entityElement.appendChild(titleEl);
            
            entityElement.addEventListener('click', () => {
                addLogMessage(entity.name, `Details: ${entity.userPrompt} (by ${entity.ownerUsername})`);
            });
            gameCanvas.appendChild(entityElement);
            gsap.set(entityElement, { opacity: 0, scale: 0.5 }); 
        }
        
        entityElement.setAttributeNS('http://www.w3.org/1999/xlink', 'href', entity.imageUrl);
        entityElement.setAttribute('x', entity.x);
        entityElement.setAttribute('y', entity.y);
        entityElement.setAttribute('width', ENTITY_DISPLAY_SIZE);
        entityElement.setAttribute('height', ENTITY_DISPLAY_SIZE);
        // Ensure transformOrigin is correct for SVG elements if scaling from center
        // The x,y attributes are top-left, so center would be x + width/2, y + height/2
        // GSAP handles this for x and y tweens, but explicit scale origin might be needed if not default.
        
        const titleEl = entityElement.querySelector('title');
        titleEl.textContent = `${entity.name} (created by ${entity.ownerUsername || 'Unknown'}). Prompt: "${entity.userPrompt}"`;

        gsap.to(entityElement, { opacity: 1, scale: 1, x: entity.x, y: entity.y, duration: 0.5, ease: "back.out(1.7)" });
    }
}

function renderPlayers(presence) {
    playersListDiv.innerHTML = '';
    for (const clientId in presence) {
        const player = presence[clientId];
        if (player && player.username && room.peers[clientId]) {
            const playerDiv = document.createElement('div');
            playerDiv.classList.add('player-item');

            const avatarImg = document.createElement('img');
            avatarImg.src = room.peers[clientId].avatarUrl || `https://images.websim.com/avatar/${player.username}`;
            avatarImg.alt = player.username;
            avatarImg.classList.add('player-avatar');

            const usernameSpan = document.createElement('span');
            usernameSpan.textContent = player.username;

            playerDiv.appendChild(avatarImg);
            playerDiv.appendChild(usernameSpan);
            playersListDiv.appendChild(playerDiv);
        }
    }
}

function renderAssetLibrary(assets) {
    assetLibraryListDiv.innerHTML = '';
    if (!assets || assets.length === 0) {
        assetLibraryListDiv.innerHTML = '<p>No assets generated yet. Process a "create" comment!</p>';
        return;
    }

    assets.forEach(asset => {
        if (!asset.imageUrl || !asset.name) return; // Skip incomplete assets

        const assetItemDiv = document.createElement('div');
        assetItemDiv.classList.add('asset-item');

        const assetImg = document.createElement('img');
        assetImg.src = asset.imageUrl;
        assetImg.alt = asset.name;
        assetImg.draggable = true;
        assetImg.addEventListener('dragstart', (event) => {
            event.dataTransfer.setData("application/json", JSON.stringify({
                name: asset.name,
                imageUrl: asset.imageUrl,
                originalPrompt: asset.originalPrompt || "N/A"
            }));
            event.dataTransfer.effectAllowed = "copy";
        });

        const assetNameP = document.createElement('p');
        assetNameP.classList.add('asset-item-name');
        assetNameP.textContent = asset.name;

        assetItemDiv.appendChild(assetImg);
        assetItemDiv.appendChild(assetNameP);
        assetLibraryListDiv.appendChild(assetItemDiv);
    });
}


async function fetchCommentsAPI(limit = 10) {
    if (!currentProjectId) return null;
    try {
        const response = await fetch(`/api/v1/projects/${currentProjectId}/comments?sort_by=created_at&sort_order=desc&first=${limit}`);
        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Failed to fetch comments:", error);
        addLogMessage("Error", `Failed to fetch comments: ${error.message}`);
        return null;
    }
}

function processFetchedComments(apiResponse, isInitialLoad = false) {
    if (!apiResponse || !apiResponse.comments || !apiResponse.comments.data) {
        if (isInitialLoad && metadataComments.length === 0) {
             metadataCommentsListDiv.innerHTML = '<p>No comments found for this project yet.</p>';
        }
        return false; // No new comments or error
    }

    let newCommentsAdded = false;
    const fetchedApiComments = apiResponse.comments.data.map(item => item.comment).reverse(); // Reverse to process oldest first from the batch

    for (const apiComment of fetchedApiComments) {
        if (knownCommentIds.has(apiComment.id)) {
            // If it's a full refresh (not initial load) and we want to update existing, we could.
            // For now, just skip if known.
            continue;
        }

        knownCommentIds.add(apiComment.id);
        const newAugmentedComment = {
            id: apiComment.id,
            apiData: apiComment,
            timestamp: new Date(apiComment.created_at).getTime(),
            user: apiComment.author ? apiComment.author.username : 'Unknown User',
            prompt: apiComment.raw_content || (apiComment.content ? "Rich content (cannot auto-process)" : "No prompt text available"),
            status: 'pending',
            processed: false,
            outputMessage: null,
        };
        metadataComments.push(newAugmentedComment); // Add to end, then sort
        newCommentsAdded = true;
    }

    if (newCommentsAdded || isInitialLoad) {
        metadataComments.sort((a, b) => b.timestamp - a.timestamp); // Sort newest first
        renderMetadataComments();
    }
    return newCommentsAdded;
}

async function fetchInitialComments(forceRefresh = false) {
    if (!currentProjectId) return;
    if (forceRefresh) {
        metadataComments = [];
        knownCommentIds.clear();
        metadataCommentsListDiv.innerHTML = '<p>Refreshing comments...</p>';
    } else {
        metadataCommentsListDiv.innerHTML = '<p>Loading comments...</p>';
    }
    setLoading(true, "Loading comments...");
    const apiResponse = await fetchCommentsAPI(20); // Fetch more for initial load
    processFetchedComments(apiResponse, true);
    setLoading(false);
     if (metadataComments.length === 0 && !forceRefresh) {
        metadataCommentsListDiv.innerHTML = '<p>No comments found for this project yet.</p>';
    }
}

async function fetchNewComments() {
    if (!currentProjectId) return;
    const apiResponse = await fetchCommentsAPI(5); // Fetch fewer for polling
    const newAdded = processFetchedComments(apiResponse, false);
    if (newAdded) {
        addLogMessage("System", "New comments loaded.");
    }
}


function renderMetadataComments() {
    metadataCommentsListDiv.innerHTML = '';
    if (metadataComments.length === 0) {
        metadataCommentsListDiv.innerHTML = '<p>No comments to display. Waiting for new comments...</p>';
        return;
    }

    metadataComments.forEach(comment => {
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('metadata-comment-item');
        itemDiv.setAttribute('data-comment-id', comment.id);

        const metaP = document.createElement('p');
        metaP.classList.add('comment-meta');
        const userAvatar = comment.apiData.author && comment.apiData.author.avatar_url ? 
            `<img src="${comment.apiData.author.avatar_url}" alt="${comment.user}" class="comment-author-avatar">` :
            `<img src="https://images.websim.com/avatar/${comment.user}" alt="${comment.user}" class="comment-author-avatar">`;
        
        metaP.innerHTML = `${userAvatar} By: <strong>${comment.user}</strong> - ${new Date(comment.timestamp).toLocaleString()}`;


        const promptP = document.createElement('p');
        promptP.classList.add('comment-prompt');
        promptP.textContent = `Prompt: "${comment.prompt}"`;
        
        const statusP = document.createElement('p');
        statusP.classList.add('comment-status', `status-${comment.status}`);
        statusP.textContent = `Status: ${comment.status.charAt(0).toUpperCase() + comment.status.slice(1)}`;

        itemDiv.appendChild(metaP);
        itemDiv.appendChild(promptP);
        itemDiv.appendChild(statusP);

        if (comment.outputMessage) {
            const outputP = document.createElement('p');
            outputP.classList.add('comment-output');
            outputP.textContent = `Output: ${comment.outputMessage}`;
            itemDiv.appendChild(outputP);
        }
        
        const canProcess = comment.prompt && !comment.prompt.startsWith("Rich content");

        const processButton = document.createElement('button');
        processButton.textContent = (comment.status === 'success' || comment.status === 'error') ? 'Re-process' : 'Process';
        if (comment.status === 'processing' || !canProcess) {
            processButton.disabled = true;
            if (!canProcess) processButton.textContent = 'Cannot Auto-Process';
            else processButton.textContent = 'Processing...';
        }
        processButton.addEventListener('click', () => handleCommentClick(comment.id));
        
        itemDiv.appendChild(processButton);
        metadataCommentsListDiv.appendChild(itemDiv);
    });
}

function handleCommentClick(commentId) {
    const comment = metadataComments.find(c => c.id === commentId);
    if (!comment) {
        addLogMessage("Error", `Comment ${commentId} not found.`);
        return;
    }
    if (!comment.prompt || comment.prompt.startsWith("Rich content")) {
        addLogMessage("System", `Cannot automatically process comment "${comment.id}" as it's rich content or has no prompt.`);
        return;
    }
    processCommentPrompt(comment);
}

async function processCommentPrompt(comment) {
    if (comment.status === 'processing') {
        addLogMessage("System", `Comment "${comment.prompt}" by ${comment.user} is already being processed.`);
        return;
    }

    comment.status = 'processing';
    // comment.processed = true; // This seems redundant if status handles it
    renderMetadataComments(); 

    const commandText = comment.prompt;

    setLoading(true, `Processing: "${commandText.substring(0, 30)}..."`);
    addLogMessage(comment.user || "System", `Executing: "${commandText}"`);

    try {
        const currentEntitiesForLlm = Object.values(room.roomState.entities || {})
            .filter(e => e && e.name && e.userPrompt)
            .map(e => ({ 
                id: e.id, 
                name: e.name, 
                user_prompt: e.userPrompt,
                ownerUsername: e.ownerUsername 
            }));

        const systemPrompt = `You are a creative game master for a collaborative, generative world displayed on a 2D canvas. Players interact by submitting "comments" which are prompts/commands.
Your primary goal is to interpret these prompts and respond with JSON to manipulate the game world or provide information.

Available actions:
1.  **Create an entity**: (e.g., "add a happy sun", "draw a mysterious forest")
    *   Respond with: { "action": "create_entity", "name": "entity_name", "image_prompt": "detailed visual description for AI image generation (aim for transparent background)", "user_prompt": "${commandText}" }
    *   'entity_name' should be concise.
    *   'image_prompt' should be rich. Specify art styles if implied. Example: "A whimsical, fluffy pink cloud with a smiling face, cartoon style, transparent background."

2.  **Describe the world or an entity**: (e.g., "what do I see?", "tell me about the dragon")
    *   If general: { "action": "describe_world", "description": "an evocative summary of the scene" }
    *   If specific to an entity (find by name): { "action": "describe_entity", "entity_name": "target_entity_name", "description": "details about this entity" }

3.  **General Chat / Unrecognized commands**:
    *   Respond with: { "action": "chat_message", "message": "your conversational response or clarification request" }

Current entities in the world:
${JSON.stringify(currentEntitiesForLlm)}

Respond ONLY with a valid JSON object.`;

        let currentConversation = [
            { role: "system", content: systemPrompt },
            { role: "user", content: commandText }
        ];

        const completion = await websim.chat.completions.create({
            messages: currentConversation, 
            json: true,
        });
        
        const responseData = JSON.parse(completion.content);
        await processLlmResponse(responseData, commandText, comment.user);

        comment.status = 'success';
        comment.outputMessage = responseData.description || responseData.message || `Action '${responseData.action}' completed.`;
        if (responseData.action === 'create_entity' && responseData.name) {
            comment.outputMessage = `${responseData.name} created.`;
        }

    } catch (error) {
        console.error(`LLM or command processing error for comment by ${comment.user}:`, error);
        addLogMessage("Error", `Failed to process comment "${comment.prompt}" by ${comment.user}: ${error.message}`);
        comment.status = 'error';
        comment.outputMessage = `Error: ${error.message}`;
    } finally {
        comment.processed = true; // Mark as processed regardless of outcome for re-process logic
        setLoading(false);
        renderMetadataComments(); 
    }
}

async function processLlmResponse(responseData, originalUserPrompt, commentAuthorUsername) {
    addLogMessage("Game Master (AI)", `Action: ${responseData.action}` + (responseData.name ? ` - ${responseData.name}` : '') + (responseData.message ? ` - ${responseData.message}`: '') + (responseData.description ? ` - Preview: ${responseData.description.substring(0,50)}...`: ''));

    switch (responseData.action) {
        case 'create_entity':
            setLoading(true, `Generating image for ${responseData.name}...`); 
            try {
                const imageResult = await websim.imageGen({
                    prompt: responseData.image_prompt,
                    transparent: true,
                    aspect_ratio: "1:1"
                });

                if (!imageResult || !imageResult.url) {
                    throw new Error("Image generation failed to return a URL.");
                }

                // Create the asset in the persistent asset library
                await assetCollection.create({
                    name: responseData.name,
                    imageUrl: imageResult.url,
                    originalPrompt: responseData.image_prompt, // Store the prompt used for image gen
                    creatorUsername: commentAuthorUsername || "Unknown",
                    createdAt: Date.now()
                });
                addLogMessage("System", `${responseData.name} added to Asset Library by ${commentAuthorUsername}.`);


                // Also create an instance of the entity on the canvas from the original comment
                const entityId = `entity-${room.clientId}-${Date.now()}`; 
                const newEntity = {
                    id: entityId,
                    name: responseData.name,
                    imageUrl: imageResult.url,
                    x: Math.random() * (WORLD_WIDTH - ENTITY_DISPLAY_SIZE),
                    y: Math.random() * (WORLD_HEIGHT - ENTITY_DISPLAY_SIZE),
                    ownerClientId: room.clientId, 
                    ownerUsername: commentAuthorUsername || "Unknown", 
                    userPrompt: originalUserPrompt, // The comment that triggered this
                    createdAt: Date.now()
                };
                
                const updatedEntities = { ... (room.roomState.entities || {}) };
                updatedEntities[entityId] = newEntity;

                await room.updateRoomState({ entities: updatedEntities });
                addLogMessage("System", `${responseData.name} has been created on canvas by ${commentAuthorUsername}!`);

            } catch (error) {
                console.error("Image generation or entity creation error:", error);
                addLogMessage("Error", `Could not create ${responseData.name}: ${error.message}`);
                throw error; 
            } 
        break;

        case 'describe_world':
            addLogMessage("Game Master (AI)", responseData.description);
            break;

        case 'describe_entity':
            addLogMessage(`Game Master (AI) on ${responseData.entity_name}`, responseData.description);
            break;
            
        case 'chat_message':
            addLogMessage("Game Master (AI)", responseData.message);
            break;

        default:
            addLogMessage("Error", `Unknown action from AI: ${responseData.action}`);
            console.warn("Unknown AI action:", responseData);
            throw new Error(`Unknown AI action: ${responseData.action}`);
    }
}

function handleDragOverCanvas(event) {
    event.preventDefault(); // Necessary to allow dropping
    event.dataTransfer.dropEffect = "copy";
    gameCanvas.classList.add('drag-over');
}

async function handleDropOnCanvas(event) {
    event.preventDefault();
    gameCanvas.classList.remove('drag-over');
    const dataString = event.dataTransfer.getData("application/json");
    if (!dataString) {
        console.warn("Drop event with no data or incorrect data type.");
        return;
    }

    try {
        const assetData = JSON.parse(dataString);
        if (!assetData.imageUrl || !assetData.name) {
            console.warn("Dropped data is missing imageUrl or name.", assetData);
            return;
        }

        const CTM = gameCanvas.getScreenCTM();
        if (!CTM) {
            console.error("Could not get CTM for SVG canvas.");
            return;
        }
        const svgPoint = gameCanvas.createSVGPoint();
        svgPoint.x = event.clientX;
        svgPoint.y = event.clientY;
        
        const canvasPoint = svgPoint.matrixTransform(CTM.inverse());

        let dropX = canvasPoint.x - ENTITY_DISPLAY_SIZE / 2;
        let dropY = canvasPoint.y - ENTITY_DISPLAY_SIZE / 2;

        // Clamp coordinates to world boundaries
        dropX = Math.max(0, Math.min(dropX, WORLD_WIDTH - ENTITY_DISPLAY_SIZE));
        dropY = Math.max(0, Math.min(dropY, WORLD_HEIGHT - ENTITY_DISPLAY_SIZE));

        const currentUser = await window.websim.getCurrentUser();
        const draggerUsername = currentUser ? currentUser.username : "Unknown Dragger";

        const entityId = `entity-drag-${room.clientId}-${Date.now()}`;
        const newEntity = {
            id: entityId,
            name: assetData.name,
            imageUrl: assetData.imageUrl,
            x: dropX,
            y: dropY,
            ownerClientId: room.clientId,
            ownerUsername: draggerUsername,
            userPrompt: `Placed '${assetData.name}' from asset library. Original gen prompt: "${assetData.originalPrompt}"`,
            createdAt: Date.now()
        };

        const updatedEntities = { ... (room.roomState.entities || {}) };
        updatedEntities[entityId] = newEntity;
        await room.updateRoomState({ entities: updatedEntities });

        addLogMessage("System", `${assetData.name} dragged onto canvas at (${Math.round(dropX)}, ${Math.round(dropY)}) by ${draggerUsername}.`);

    } catch (error) {
        console.error("Error processing dropped asset:", error);
        addLogMessage("Error", `Failed to place asset on canvas: ${error.message}`);
    }
}


function addLogMessage(sender, message) {
    const messageElement = document.createElement('p');
    const senderStrong = document.createElement('strong');
    senderStrong.textContent = `${sender}: `;
    messageElement.appendChild(senderStrong);
    messageElement.appendChild(document.createTextNode(message));
    
    messageLog.appendChild(messageElement);
    messageLog.scrollTop = messageLog.scrollHeight;
}

init();