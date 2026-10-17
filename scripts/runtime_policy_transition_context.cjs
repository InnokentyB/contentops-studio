const ts=require('typescript');
const {digest}=require('./runtime_policy_scanner.cjs');
const {fail}=require('./runtime_policy_budget.cjs');
const printer=ts.createPrinter({removeComments:true});
const print=(node,source)=>printer.printNode(ts.EmitHint.Unspecified,node,source);

// Same statement-context fingerprint as the existing scanner, never a looser hash.
// Only named function declaration headers are initially eligible for remapping.
function contexts(file,text,budget) {
    const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true),rows=new Map();
    if(source.parseDiagnostics.length)fail('TRANSITION_SOURCE_INVALID');
    function walk(node){
        budget.check();
        if(ts.isIdentifier(node)){
            let anchor=node;
            while(anchor.parent&&!ts.isStatement(anchor)&&!ts.isSourceFile(anchor.parent))anchor=anchor.parent;
            if(ts.isFunctionDeclaration(anchor)&&anchor.body&&anchor.name){
                const identity=digest('task_identifier\0'+print(anchor,source)+'\0'+print(node,source));
                const header=ts.factory.updateFunctionDeclaration(anchor,anchor.modifiers,anchor.asteriskToken,
                    anchor.name,anchor.typeParameters,anchor.parameters,anchor.type,undefined);
                const signature=print(header,source);
                const row=rows.get(identity);
                if(row)row.count++;else rows.set(identity,{symbol:node.text,signature,count:1});
            }
        }
        ts.forEachChild(node,walk);
    }
    walk(source);budget.check();return rows;
}
module.exports={contexts};
