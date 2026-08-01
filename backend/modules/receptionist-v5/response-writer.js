'use strict';async function writeResponse(p){return[...(p.facts||[]),p.prompt].filter(Boolean).join('\n\n').trim()}module.exports={writeResponse};
