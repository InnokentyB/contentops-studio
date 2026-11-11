const fs=require('node:fs');
const modules=process.env.AGENT_UI_MODULES||'/opt/planner/frontend/node_modules';
const source=process.env.AGENT_UI_SOURCE||'/source',results=process.env.AGENT_UI_RESULTS||'/results';
const {buildSync}=require(modules+'/esbuild');
const postcss=require(modules+'/postcss'),tailwind=require(modules+'/tailwindcss');
(async()=>{
 // CI has both root peer dependencies and frontend dependencies installed. Pin one React identity.
 buildSync({entryPoints:[source+'/tests/egress/agent-save-ui-fixture.tsx'],bundle:true,jsx:'automatic',nodePaths:[modules],alias:{react:modules+'/react','react-dom':modules+'/react-dom','@tanstack/react-query':modules+'/@tanstack/react-query'},outfile:results+'/fixture.js',format:'iife',external:['/fonts/*'],define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'}});
 const css=await postcss([tailwind({config:source+'/frontend/tailwind.config.js'})]).process(fs.readFileSync(results+'/fixture.css','utf8'),{from:source+'/frontend/src/index.css'});
 fs.writeFileSync(results+'/fixture.css',css.css);
 buildSync({entryPoints:[source+'/tests/egress/agent-api-client.ts'],bundle:true,platform:'node',format:'cjs',outfile:results+'/client-tests.cjs'});
})().catch(error=>{console.error(error);process.exitCode=1;});
