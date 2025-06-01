import { gsap } from 'gsap';

const gameCanvas = document.getElementById('game-canvas');
const commandInput = document.getElementById('command-input');
const submitCommandButton = document.getElementById('submit-command');
const messageLog = document.getElementById('message-log');
const playersListDiv = document.getElementById('players-list');
const loadingOverlay = document.getElementById('loading-overlay');

const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 600;
const ENTITY_DISPLAY_SIZE = 80; // Base size for displaying entities

const room = new WebsimSocket();
let conversationHistory = [];

async function init() {
    setLoading(true, "Initializing...");
    try {
        await room.initialize();

        // Initialize room state if it's the first user or state is missing
        if (!room.roomState || typeof room.roomState.entities === 'undefined') {
            await room.updateRoomState({
                entities: {}, // Store entities as { id: { data... } }
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
        
        // Initial render based on current state
        handleRoomStateUpdate(room.roomState);
        handlePresenceUpdate(room.presence);

        submitCommandButton.addEventListener('click', handleCommandSubmit);
        commandInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleCommandSubmit();
            }
        });

        addLogMessage("System", "Game initialized. Describe what you want to create!");

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
        submitCommandButton.disabled = true;
        commandInput.disabled = true;
    } else {
        loadingOverlay.classList.add('hidden');
        submitCommandButton.disabled = false;
        commandInput.disabled = false;
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
    // Clear existing entities, except player cursors if any
    // A more sophisticated approach would be to update/add/remove specific SVG elements
    while (gameCanvas.firstChild) {
        // Don't remove player avatar elements if they are part of the canvas
        // For now, assuming all children are game entities
        gameCanvas.removeChild(gameCanvas.firstChild);
    }

    for (const entityId in entities) {
        const entity = entities[entityId];
        if (!entity) continue; // Skip if entity was deleted (null)

        const entityElement = document.createElementNS("http://www.w3.org/2000/svg", "image");
        entityElement.setAttribute('id', entity.id);
        entityElement.setAttributeNS('http://www.w3.org/1999/xlink', 'href', entity.imageUrl);
        entityElement.setAttribute('x', entity.x);
        entityElement.setAttribute('y', entity.y);
        entityElement.setAttribute('width', ENTITY_DISPLAY_SIZE);
        entityElement.setAttribute('height', ENTITY_DISPLAY_SIZE);
        entityElement.setAttribute('class', 'game-entity');
        entityElement.style.transformOrigin = `${entity.x + ENTITY_DISPLAY_SIZE/2}px ${entity.y + ENTITY_DISPLAY_SIZE/2}px`; // For scaling from center

        // Add a title for hover info
        const titleEl = document.createElementNS("http://www.w3.org/2000/svg", "title");
        titleEl.textContent = `${entity.name} (created by ${entity.ownerUsername || 'Unknown'}). Prompt: "${entity.userPrompt}"`;
        entityElement.appendChild(titleEl);
        
        entityElement.addEventListener('click', () => {
            addLogMessage(entity.name, `Details: ${entity.userPrompt} (by ${entity.ownerUsername})`);
        });

        gameCanvas.appendChild(entityElement);
        gsap.fromTo(entityElement, { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.7)" });
    }
}

function renderPlayers(presence) {
    playersListDiv.innerHTML = ''; // Clear old list
    for (const clientId in presence) {
        const player = presence[clientId];
        if (player && player.username && room.peers[clientId]) { // Ensure player data and peer info exist
            const playerDiv = document.createElement('div');
            playerDiv.classList.add('player-item');

            const avatarImg = document.createElement('img');
            avatarImg.src = room.peers[clientId].avatarUrl || 'https://images.websim.com/default-avatar.png'; // Use actual avatar or a default
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

async function handleCommandSubmit() {
    const commandText = commandInput.value.trim();
    if (!commandText) return;

    setLoading(true, "Thinking...");
    addLogMessage(room.peers[room.clientId]?.username || "You", commandText);
    commandInput.value = ''; // Clear input

    try {
        const currentEntitiesForLlm = Object.values(room.roomState.entities || {})
            .filter(e => e && e.name && e.userPrompt) // Ensure entity is not null and has necessary fields
            .map(e => ({ 
                id: e.id, 
                name: e.name, 
                user_prompt: e.userPrompt,
                ownerUsername: e.ownerUsername 
            }));

        const systemPrompt = `You are a creative game master for a collaborative, generative world displayed on a 2D canvas. Players interact by typing commands.
Your primary goal is to interpret player commands and respond with JSON to manipulate the game world or provide information.

Available player commands you should try to interpret:
1.  **Create an entity**: (e.g., "add a happy sun", "draw a mysterious forest")
    *   Respond with: { "action": "create_entity", "name": "entity_name", "image_prompt": "detailed visual description for AI image generation (aim for transparent background)", "user_prompt": "${commandText}" }
    *   'entity_name' should be concise.
    *   'image_prompt' should be rich and guide the image generator. Specify art styles if implied by the user (e.g., 'pixel art', 'vector illustration', 'realistic photo'). Example: "A whimsical, fluffy pink cloud with a smiling face, cartoon style, transparent background."

2.  **Describe the world or an entity**: (e.g., "what do I see?", "tell me about the dragon")
    *   If general: { "action": "describe_world", "description": "an evocative summary of the scene" }
    *   If specific to an entity: { "action": "describe_entity", "entity_name": "target_entity_name", "description": "details about this entity" } (You'll need to find target_entity_name from current_entities)

3.  **General Chat / Unrecognized commands**:
    *   Respond with: { "action": "chat_message", "message": "your conversational response or clarification request" }

Current entities in the world:
${JSON.stringify(currentEntitiesForLlm)}

Respond ONLY with a valid JSON object.`;

        conversationHistory.push({ role: "user", content: commandText });
        conversationHistory = conversationHistory.slice(-6); // Keep history short

        const completion = await websim.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                ...conversationHistory
            ],
            json: true,
        });
        
        conversationHistory.push(completion); // Add AI response to history

        const responseData = JSON.parse(completion.content);
        await processLlmResponse(responseData, commandText);

    } catch (error) {
        console.error("LLM or command processing error:", error);
        addLogMessage("Error", `Failed to process command: ${error.message}`);
        conversationHistory.pop(); // Remove failed user message if LLM call errored
    } finally {
        setLoading(false);
    }
}

async function processLlmResponse(responseData, originalUserPrompt) {
    addLogMessage("Game Master (AI)", `Action: ${responseData.action}` + (responseData.name ? ` - ${responseData.name}` : ''));

    switch (responseData.action) {
        case 'create_entity':
            setLoading(true, `Generating image for ${responseData.name}...`);
            try {
                const imageResult = await websim.imageGen({
                    prompt: responseData.image_prompt,
                    transparent: true, // Important for parsing out white backgrounds
                    aspect_ratio: "1:1" // Keep it square for consistency
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
                    ownerUsername: room.peers[room.clientId]?.username || "Unknown",
                    userPrompt: originalUserPrompt,
                    createdAt: Date.now()
                };
                
                // Use an object for entities to allow easy addition/deletion by ID
                const updatedEntities = { ... (room.roomState.entities || {}) };
                updatedEntities[entityId] = newEntity;

                await room.updateRoomState({ entities: updatedEntities });
                addLogMessage("System", `${responseData.name} has been created!`);

            } catch (error) {
                console.error("Image generation or entity creation error:", error);
                addLogMessage("Error", `Could not create ${responseData.name}: ${error.message}`);
            } finally {
                setLoading(false);
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
    }
}

function addLogMessage(sender, message) {
    const messageElement = document.createElement('p');
    const senderStrong = document.createElement('strong');
    senderStrong.textContent = `${sender}: `;
    messageElement.appendChild(senderStrong);
    messageElement.appendChild(document.createTextNode(message));
    
    messageLog.appendChild(messageElement);
    messageLog.scrollTop = messageLog.scrollHeight; // Auto-scroll to bottom
}


// Start the application
init();


