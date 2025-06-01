import { gsap } from 'gsap';

const gameCanvas = document.getElementById('game-canvas');
const messageLog = document.getElementById('message-log');
const playersListDiv = document.getElementById('players-list');
const loadingOverlay = document.getElementById('loading-overlay');
const metadataCommentsListDiv = document.getElementById('metadata-comments-list');
const simulateNewCommentButton = document.getElementById('simulate-new-comment-btn');

const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 600;
const ENTITY_DISPLAY_SIZE = 80;

const room = new WebsimSocket();
let conversationHistory = [];
let metadataComments = [];
let commentIdCounter = 0;

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
        
        handleRoomStateUpdate(room.roomState);
        handlePresenceUpdate(room.presence);

        simulateNewCommentButton.addEventListener('click', () => {
            const prompts = [
                "Create a playful kitten.", 
                "Add a giant, ancient tree.", 
                "What kind of entities are here?",
                "Make a sparkling river flow through the scene.",
                "A small, friendly robot waves hello."
            ];
            const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)];
            const users = ["UserAlpha", "UserBeta", "UserGamma"];
            const randomUser = users[Math.floor(Math.random() * users.length)];
            addSimulatedComment(randomPrompt, randomUser);
        });

        addSimulatedComment("Create a majestic dragon with fiery breath.", "SystemInit1");
        addSimulatedComment("What is in this world currently?", "SystemInit2");
        
        addLogMessage("System", "Game initialized. Process a comment from the 'Metadata Comments' list to begin or simulate a new one!");

    } catch (error) {
        console.error("Initialization failed:", error);
        addLogMessage("Error", `Initialization failed: ${error.message}`);
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
        entityElement.style.transformOrigin = `${entity.x + ENTITY_DISPLAY_SIZE/2}px ${entity.y + ENTITY_DISPLAY_SIZE/2}px`;
        
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
            avatarImg.src = room.peers[clientId].avatarUrl || `https://avatar.iran.liara.run/username?username=${player.username}`;
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

function addSimulatedComment(promptText, username) {
    commentIdCounter++;
    const newComment = {
        id: `comment-${commentIdCounter}-${Date.now()}`,
        timestamp: Date.now(),
        user: username || "Anonymous",
        prompt: promptText,
        status: 'pending', 
        processed: false,
        outputMessage: null,
    };
    metadataComments.unshift(newComment); 
    renderMetadataComments();
}

function renderMetadataComments() {
    metadataCommentsListDiv.innerHTML = '';
    if (metadataComments.length === 0) {
        metadataCommentsListDiv.innerHTML = '<p>No comments yet. Simulate one!</p>';
        return;
    }

    metadataComments.forEach(comment => {
        const itemDiv = document.createElement('div');
        itemDiv.classList.add('metadata-comment-item');
        itemDiv.setAttribute('data-comment-id', comment.id);

        const metaP = document.createElement('p');
        metaP.classList.add('comment-meta');
        metaP.textContent = `By: ${comment.user} - ${new Date(comment.timestamp).toLocaleTimeString()}`;

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

        const processButton = document.createElement('button');
        processButton.textContent = (comment.status === 'success' || comment.status === 'error') ? 'Re-process' : 'Process';
        if (comment.status === 'processing') {
            processButton.disabled = true;
            processButton.textContent = 'Processing...';
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
    processCommentPrompt(comment);
}

async function processCommentPrompt(comment) {
    if (comment.status === 'processing') {
        addLogMessage("System", `Comment "${comment.prompt}" by ${comment.user} is already being processed.`);
        return;
    }

    comment.status = 'processing';
    comment.processed = true; 
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

                const entityId = `entity-${room.clientId}-${Date.now()}`; 
                const newEntity = {
                    id: entityId,
                    name: responseData.name,
                    imageUrl: imageResult.url,
                    x: Math.random() * (WORLD_WIDTH - ENTITY_DISPLAY_SIZE),
                    y: Math.random() * (WORLD_HEIGHT - ENTITY_DISPLAY_SIZE),
                    ownerClientId: room.clientId, 
                    ownerUsername: commentAuthorUsername || "Unknown", 
                    userPrompt: originalUserPrompt, 
                    createdAt: Date.now()
                };
                
                const updatedEntities = { ... (room.roomState.entities || {}) };
                updatedEntities[entityId] = newEntity;

                await room.updateRoomState({ entities: updatedEntities });
                addLogMessage("System", `${responseData.name} has been created by ${commentAuthorUsername}!`);

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