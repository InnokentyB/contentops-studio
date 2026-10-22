const fs=require('node:fs');
const {buildSync}=require('/opt/planner/frontend/node_modules/esbuild');
const postcss=require('/opt/planner/frontend/node_modules/postcss');
const tailwind=require('/opt/planner/frontend/node_modules/tailwindcss');
(async()=>{
 buildSync({entryPoints:['/source/tests/tdpd/project-channel-list-fixture.tsx'],bundle:true,jsx:'automatic',nodePaths:['/opt/planner/frontend/node_modules'],outfile:'/results/fixture.js',format:'iife',external:['/fonts/*'],define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'}});
 const css=await postcss([tailwind({config:'/source/frontend/tailwind.config.js'})]).process(fs.readFileSync('/results/fixture.css','utf8'),{from:'/source/frontend/src/index.css',to:'/results/fixture.css'});
 fs.writeFileSync('/results/fixture.css',css.css);
})().catch(error=>{console.error(error);process.exitCode=1;});
