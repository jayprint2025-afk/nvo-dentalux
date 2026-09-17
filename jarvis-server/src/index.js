import express from'express';import cors from'cors';import'dotenv/config';import crypto from'node:crypto';
const app=express(),PORT=Number(process.env.PORT||10000),CENTRAL=(process.env.CENTRAL_API_URL||'').replace(/\/$/,'');
app.use(cors({origin:process.env.ALLOWED_ORIGIN||true}));app.use(express.json());const reminders=[];
app.get('/api/health',async(_q,s)=>{let c=false;if(CENTRAL)try{c=(await fetch(`${CENTRAL}/api/health`,{signal:AbortSignal.timeout(3500)})).ok}catch{}s.json({ok:true,service:'jarvis-server',version:'0.2.0',central_connected:c})});
app.get('/api/reminders',(_q,s)=>s.json({items:reminders}));
app.post('/api/reminders',(q,s)=>{const title=String(q.body?.title||'').trim(),due_at=String(q.body?.due_at||'');if(!title||!due_at)return s.status(400).json({error:'title y due_at requeridos'});const x={id:crypto.randomUUID(),title,due_at,status:'pending'};reminders.push(x);s.status(201).json(x)});
app.get('/api/central/status',(_q,s)=>s.json({configured:Boolean(CENTRAL)}));app.listen(PORT,'0.0.0.0',()=>console.log(`JARVIS Server ${PORT}`));
