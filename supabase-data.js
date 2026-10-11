const dropyClient = window.supabase.createClient(DROPY_SUPABASE_URL, DROPY_SUPABASE_KEY);
function dropyFromRow(p){return {...p, addedOn:p.added_on,logoUrl:p.logo_url};}
function dropyToRow(p){return {name:p.name,task:p.task,category:p.category,status:p.status,funding:p.funding,investors:p.investors,description:p.description,color:p.color,added_on:p.addedOn||null,logo_url:p.logoUrl||null,links:p.links||[],guide:p.guide||[]};}
async function dropyFetchProjects(){const {data,error}=await dropyClient.from('projects').select('*').order('id',{ascending:true});if(error)throw error;return data.map(dropyFromRow);}
