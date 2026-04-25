exports.handler = async function(event, context) {
    // Solo permitir solicitudes POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }
    
    // Obtener la clave desde las variables de entorno de Netlify
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return { statusCode: 500, body: JSON.stringify({ error: 'API Key no configurada en el servidor.' }) };
    }

    try {
        const reqBody = JSON.parse(event.body);
        const contents = reqBody.contents;

        if (!contents) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Falta el contenido (contents) en la solicitud.' }) };
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            return { 
                statusCode: response.status, 
                body: JSON.stringify({ error: data.error?.message || 'Error en la API de Google' }) 
            };
        }
        
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        return { 
            statusCode: 200, 
            body: JSON.stringify({ text }) 
        };
        
    } catch (err) {
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};
