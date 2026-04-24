// --- ESTADO GLOBAL ---
// Estado de módulos
let chatSocraticoHistory = [];
let hallucData = null; // { fragmentos: [...], resumen: "..." }
let foundErrors = new Set();

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
    // Referencias DOM
    const appScreen = document.getElementById('app');
    
    // Navegación de módulos
    const navBtns = document.querySelectorAll('.nav-btn');
    const modules = document.querySelectorAll('.module');

    // Navegación
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Actualizar botones
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Actualizar módulos
            const targetId = btn.getAttribute('data-target');
            modules.forEach(m => {
                m.classList.add('hidden');
                m.classList.remove('active');
            });
            const targetModule = document.getElementById(targetId);
            targetModule.classList.remove('hidden');
            // Timeout para activar la animación CSS
            setTimeout(() => targetModule.classList.add('active'), 10);
        });
    });

    // Eventos Modulo 1
    document.getElementById('btn-send-1').addEventListener('click', sendSocratico);
    document.getElementById('btn-reset-1').addEventListener('click', resetSocratico);
    
    // Eventos Modulo 2
    document.getElementById('btn-send-2').addEventListener('click', analizarHalluc);
    document.getElementById('btn-reset-2').addEventListener('click', resetHalluc);
    document.getElementById('btn-reveal').addEventListener('click', revelarAlucinaciones);
    
    // Eventos Modulo 3
    document.getElementById('btn-send-3').addEventListener('click', desarmarTexto);
    document.getElementById('btn-reset-3').addEventListener('click', resetDesarmador);
});

// --- COMUNICACIÓN CON EL BACKEND (NETLIFY SERVERLESS) ---
async function callGemini(contents) {
    const response = await fetch('/.netlify/functions/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        const errorMsg = errorData?.error || `Error de conexión HTTP: ${response.status}`;
        
        if (response.status === 429 || errorMsg.toLowerCase().includes("quota")) {
            throw new Error("Has excedido el límite de uso gratuito de la API de Gemini (Quota Exceeded). Por favor, espera alrededor de un minuto e intenta nuevamente, o revisa los límites de tu cuenta en Google AI Studio.");
        }
        
        throw new Error(errorMsg);
    }

    const data = await response.json();
    return data.text || '';
}

// --- MÓDULO 1: SOCIO SOCRÁTICO ---
const SOCRATICO_SYSTEM = `Eres el "Socio Socrático", un agente pedagógico de refutación crítica diseñado para estudiantes de secundaria o universidad.

Tu rol: cuando el estudiante presenta una idea, tesis o lo que le dijo una IA, tu trabajo es REFUTARLA con argumentos, preguntas y contraejemplos. NUNCA aceptes la tesis sin cuestionarla. NUNCA digas simplemente "tienes razón" ni seas condescendiente.

Estrategias que debes usar (varía entre ellas):
- Preguntar por evidencias que el alumno no mencionó
- Señalar excepciones o casos contrarios
- Cuestionar premisas implícitas o suposiciones
- Señalar falacias lógicas si las hay
- Proponer escenarios hipotéticos ("¿qué pasa si...?")

Tono: Directo, agudo, estimulante, estilo debate académico pero accesible.
Longitud: Respuestas concisas (máximo 4 oraciones cortas). Siempre termina con una pregunta desafiante que obligue al usuario a pensar.`;

function addChatMessage(role, text) {
    const container = document.getElementById('chat-socratico');
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role === 'user' ? 'user-message' : 'ai-message'}`;
    
    let html = `<div class="avatar ${role === 'ai' ? 'ai-avatar' : ''}">${role === 'user' ? 'Tú' : 'S'}</div>
                <div class="bubble">${text.replace(/\n/g, '<br>')}</div>`;
    msgDiv.innerHTML = html;
    
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
}

function addTypingIndicator(containerId) {
    const container = document.getElementById(containerId);
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message ai-message typing-indicator-msg';
    msgDiv.innerHTML = `<div class="avatar ai-avatar">S</div>
                        <div class="bubble">
                            <div class="typing-indicator"><span></span><span></span><span></span></div>
                        </div>`;
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    return msgDiv;
}

async function sendSocratico() {
    const inputEl = document.getElementById('input-socratico');
    const btn = document.getElementById('btn-send-1');
    const text = inputEl.value.trim();
    if (!text) return;

    // UI
    addChatMessage('user', text);
    inputEl.value = '';
    btn.disabled = true;
    const typingMsg = addTypingIndicator('chat-socratico');

    // Historial
    chatSocraticoHistory.push({ role: 'user', content: text });

    // Preparar payload para Gemini
    // Construimos la conversación. Si es el primero, metemos el system prompt dentro del primer user prompt.
    const contents = [];
    
    chatSocraticoHistory.forEach((msg, idx) => {
        let txt = msg.content;
        if (idx === 0) {
            txt = `[INSTRUCCIONES DE SISTEMA]:\n${SOCRATICO_SYSTEM}\n\n[MENSAJE DEL USUARIO]:\n${txt}`;
        }
        contents.push({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: txt }]
        });
    });

    try {
        const responseText = await callGemini(contents);
        typingMsg.remove();
        addChatMessage('ai', responseText);
        chatSocraticoHistory.push({ role: 'assistant', content: responseText });
    } catch (e) {
        typingMsg.remove();
        addChatMessage('ai', `⚠️ Hubo un error de conexión: ${e.message}`);
    } finally {
        btn.disabled = false;
    }
}

function resetSocratico() {
    const container = document.getElementById('chat-socratico');
    container.innerHTML = `<div class="message ai-message">
                            <div class="avatar ai-avatar">S</div>
                            <div class="bubble">Bienvenido/a. Escribe tu idea, tesis o lo que te dijo la IA. Mi trabajo no es darte la razón, sino cuestionarla y poner a prueba tu lógica.</div>
                        </div>`;
    chatSocraticoHistory = [];
    document.getElementById('input-socratico').value = '';
}

// --- MÓDULO 2: CAZADOR DE ALUCINACIONES ---
async function analizarHalluc() {
    const inputEl = document.getElementById('input-halluc');
    const btn = document.getElementById('btn-send-2');
    const originalText = inputEl.value.trim();
    if (!originalText) return;

    btn.disabled = true;
    btn.textContent = 'Analizando...';

    const prompt = `Analiza el siguiente texto e identifica posibles alucinaciones de IA, errores factuales, inconsistencias lógicas o datos sin fundamento.

Debes responder ÚNICAMENTE con un objeto JSON (sin formato Markdown, sin comillas invertidas) con la siguiente estructura estricta:
{
  "fragmentos": [
    { "texto": "fragmento exacto extraído del texto original", "esError": true, "explicacion": "explicación de por qué es un error o alucinación" }
  ],
  "resumen": "Evaluación general del texto en 2 oraciones."
}

INSTRUCCIONES:
- Incluye al menos 3 a 5 fragmentos que contengan errores o sean muy dudosos (esError: true).
- El campo "texto" DEBE SER EXACTAMENTE UNA SUBCADENA LITERAL del texto proporcionado, palabra por palabra, para que pueda ser encontrado con un buscar/reemplazar.
- No uses código Markdown (\`\`\`json) en tu respuesta.

TEXTO A ANALIZAR:
${originalText}`;

    try {
        const rawResponse = await callGemini([{ role: 'user', parts: [{ text: prompt }] }]);
        
        // Limpiar posible markdown
        const cleanJson = rawResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
        const data = JSON.parse(cleanJson);
        
        hallucData = data;
        foundErrors.clear();
        
        renderHallucText(originalText, data.fragmentos.filter(f => f.esError));
        
        document.getElementById('halluc-results').classList.remove('hidden');
        document.getElementById('halluc-feedback').classList.add('hidden');
        document.getElementById('btn-reveal').style.display = 'block';
        updateHallucScore();
        
    } catch (e) {
        alert(`Error al analizar el texto. Asegúrate de proporcionar un texto más largo y claro.\nDetalle: ${e.message}`);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Buscar Alucinaciones';
    }
}

function renderHallucText(text, errores) {
    const container = document.getElementById('halluc-text');
    let htmlText = text;
    
    // Escapar HTML básico
    htmlText = htmlText.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Subrayar los fragmentos interactivos
    errores.forEach((err, idx) => {
        // Escapar caracteres regex del texto exacto
        const escapedStr = err.texto.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const regex = new RegExp(escapedStr, 'g');
        
        htmlText = htmlText.replace(regex, `<span class="halluc-highlight" data-idx="${idx}" onclick="toggleHallucError(this, ${idx})">$&</span>`);
    });

    htmlText = htmlText.replace(/\n/g, '<br>');
    container.innerHTML = htmlText;
}

// Global function para el onclick del HTML generado
window.toggleHallucError = function(element, idx) {
    if (element.classList.contains('found')) {
        element.classList.remove('found');
        foundErrors.delete(idx);
    } else {
        element.classList.add('found');
        foundErrors.add(idx);
    }
    updateHallucScore();
};

function updateHallucScore() {
    if (!hallucData) return;
    const totalErrores = hallucData.fragmentos.filter(f => f.esError).length;
    document.getElementById('score-count').textContent = foundErrors.size;
    document.getElementById('score-total').textContent = totalErrores;
}

function revelarAlucinaciones() {
    if (!hallucData) return;
    
    const errores = hallucData.fragmentos.filter(f => f.esError);
    
    // Marcar todos en el texto
    document.querySelectorAll('.halluc-highlight').forEach(el => el.classList.add('found'));
    
    const feedbackPanel = document.getElementById('halluc-feedback');
    let html = `<h4>Análisis Completado (${foundErrors.size} de ${errores.length} identificados)</h4>`;
    html += `<ul style="list-style:none; display:flex; flex-direction:column; gap:16px; margin-top:16px;">`;
    
    errores.forEach((err, i) => {
        const isFound = foundErrors.has(i);
        html += `<li>
            <strong>"${err.texto}"</strong><br>
            <span style="color:var(--text-secondary)">↳ ${err.explicacion}</span>
            ${isFound ? '<span style="color:var(--violet); font-size:0.8rem; margin-left:8px;">[✓ Encontrado]</span>' : ''}
        </li>`;
    });
    
    html += `</ul><div style="margin-top:20px; padding-top:16px; border-top:1px solid var(--glass-border)"><strong>Resumen General:</strong> ${hallucData.resumen}</div>`;
    
    feedbackPanel.innerHTML = html;
    feedbackPanel.classList.remove('hidden');
    document.getElementById('btn-reveal').style.display = 'none';
}

function resetHalluc() {
    document.getElementById('input-halluc').value = '';
    document.getElementById('halluc-results').classList.add('hidden');
    hallucData = null;
    foundErrors.clear();
}

// --- MÓDULO 3: DESARMADOR DE VERDADES ---
async function desarmarTexto() {
    const inputEl = document.getElementById('input-truth');
    const btn = document.getElementById('btn-send-3');
    const text = inputEl.value.trim();
    if (!text) return;

    btn.disabled = true;
    btn.textContent = 'Analizando...';
    
    document.getElementById('truth-results').classList.add('hidden');

    const prompt = `Actúa como un analista de discurso crítico. Lee el siguiente texto y separa estrictamente los juicios de valor (opiniones, adjetivaciones subjetivas, valoraciones morales) de las evidencias comprobables (datos empíricos, hechos, cifras).

Debes responder ÚNICAMENTE con un objeto JSON (sin formato Markdown, sin comillas invertidas) con la siguiente estructura:
{
  "juicios": [
    "Juicio o valoración 1 identificada en el texto",
    "Juicio o valoración 2..."
  ],
  "evidencias": [
    "Hecho o evidencia empírica 1 identificada (si la hay)",
    "Hecho 2..."
  ],
  "conclusion": "Breve conclusión (2 oraciones) sobre la proporción entre hechos y opiniones en el texto."
}

TEXTO A DESARMAR:
${text}`;

    try {
        const rawResponse = await callGemini([{ role: 'user', parts: [{ text: prompt }] }]);
        
        const cleanJson = rawResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
        const data = JSON.parse(cleanJson);
        
        const listOpinions = document.getElementById('list-opinions');
        const listFacts = document.getElementById('list-facts');
        
        listOpinions.innerHTML = '';
        listFacts.innerHTML = '';
        
        if (data.juicios && data.juicios.length > 0) {
            data.juicios.forEach(j => {
                const li = document.createElement('li');
                li.textContent = j;
                listOpinions.appendChild(li);
            });
        } else {
            listOpinions.innerHTML = '<li style="opacity:0.5">No se encontraron juicios explícitos.</li>';
        }
        
        if (data.evidencias && data.evidencias.length > 0) {
            data.evidencias.forEach(e => {
                const li = document.createElement('li');
                li.textContent = e;
                listFacts.appendChild(li);
            });
        } else {
            listFacts.innerHTML = '<li style="opacity:0.5">No se encontraron evidencias o hechos comprobables.</li>';
        }
        
        document.getElementById('truth-conclusion-text').textContent = data.conclusion || '';
        document.getElementById('truth-results').classList.remove('hidden');
        
    } catch (e) {
        alert(`Error al descomponer el texto.\nDetalle: ${e.message}`);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Desarmar Verdad';
    }
}

function resetDesarmador() {
    document.getElementById('input-truth').value = '';
    document.getElementById('truth-results').classList.add('hidden');
}
