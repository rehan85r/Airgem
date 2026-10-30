const dropyClient = window.supabase.createClient(DROPY_SUPABASE_URL, DROPY_SUPABASE_KEY);
function dropyFromRow(p){return {...p, addedOn:p.added_on,logoUrl:p.logo_url,displayTag:p.display_tag||'',activityStatus:p.activity_status||'Active',ecosystem:p.ecosystem||'',started:p.launch_date||'',tge:p.tge||'',cost:p.cost||'',investors:p.investors||'',tasksFrequency:p.tasks_frequency||''};}
;}
async function dropyFetchProjects(){const {data,error}=await dropyClient.from('projects').select('*').order('added_on',{ascending:false,nullsFirst:false}).order('created_at',{ascending:false,nullsFirst:false}).order('id',{ascending:false});if(error)throw error;return data.map(dropyFromRow);}
