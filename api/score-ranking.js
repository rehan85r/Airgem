// Global leaderboard backed by Supabase. Only the server writes to this table.
const headers = () => ({'apikey':process.env.SUPABASE_SERVICE_ROLE_KEY||'', 'Authorization':'Bearer '+(process.env.SUPABASE_SERVICE_ROLE_KEY||''),'Content-Type':'application/json'});
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'GET required'});
  const base=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
  if(!base||!process.env.SUPABASE_SERVICE_ROLE_KEY)return res.status(503).json({error:'Ranking database not configured'});
  try{
    const r=await fetch(base+'/rest/v1/airgem_score_ranking?select=name,score,checked_at&order=score.desc,checked_at.desc&limit=1',{headers:headers(),signal:AbortSignal.timeout(6500)});
    if(!r.ok)throw Error('Ranking database unavailable');
    const data=await r.json();
    const c=await fetch(base+'/rest/v1/airgem_score_ranking?select=id',{headers:{...headers(),'Prefer':'count=exact'},signal:AbortSignal.timeout(6500)});
    const count=c.headers.get('content-range');const total=count&&count.includes('/')?Number(count.split('/')[1]):null;
    res.status(200).json({leader:data[0]||null,total:Number.isFinite(total)?total:null});
  }catch(e){res.status(503).json({error:'Ranking temporarily unavailable'})}
};
