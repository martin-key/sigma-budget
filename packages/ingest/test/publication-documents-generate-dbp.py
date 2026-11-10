"""Development-only transcription of donor declarations, never a runtime producer.
Run with explicit Python 3.12 and the immutable donor path. No PDF/expected JSON is read.
"""
import ast, json, sys
from pathlib import Path

source = Path(sys.argv[1]).read_text()
main = next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == 'main')
specs = []
def capture(kind):
    return lambda *args, **kw: specs.append({'kind': kind, 'args': args, 'options': kw})
env = {'T': capture('table'), 'Q': capture('quote')}
start = next(i for i,n in enumerate(main.body) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='P3' for t in n.targets))
end = next(i for i,n in enumerate(main.body) if isinstance(n,ast.FunctionDef) and n.name=='table7')
exec(compile(ast.Module(main.body[start:end],[]), '<donor-declarations>', 'exec'),env)

def expr(n):
    if isinstance(n,ast.Constant): return json.dumps(n.value,ensure_ascii=False)
    if isinstance(n,ast.Name): return n.id
    if isinstance(n,ast.List) or isinstance(n,ast.Tuple): return '['+','.join(map(expr,n.elts))+']'
    if isinstance(n,ast.Subscript): return expr(n.value)+'['+expr(n.slice)+']'
    if isinstance(n,ast.BinOp):
        op={ast.Add:'+',ast.Sub:'-',ast.Mult:'*',ast.Div:'/'}[type(n.op)]
        return '('+expr(n.left)+op+expr(n.right)+')'
    if isinstance(n,ast.UnaryOp): return ('!' if isinstance(n.op,ast.Not) else '-')+'('+expr(n.operand)+')'
    if isinstance(n,ast.Compare):
        assert len(n.ops)==1
        op={ast.Eq:'===',ast.Lt:'<',ast.LtE:'<=',ast.Gt:'>',ast.GtE:'>='}[type(n.ops[0])]
        return '('+expr(n.left)+op+expr(n.comparators[0])+')'
    if isinstance(n,ast.GeneratorExp):
        g=n.generators[0]; assert len(n.generators)==1 and not g.ifs
        return expr(g.iter)+'.map(('+expr(g.target)+')=>'+expr(n.elt)+')'
    if isinstance(n,ast.JoinedStr):
        parts=[]
        for p in n.values:
            if isinstance(p,ast.Constant): parts.append(json.dumps(p.value,ensure_ascii=False))
            elif p.format_spec: parts.append('fixed('+expr(p.value)+','+p.format_spec.values[0].value[1:-1]+')')
            else: parts.append(('String(' if isinstance(p.value,ast.Name) and p.value.id=='y' else 'pystr(')+expr(p.value)+')')
        return '('+'+'.join(parts)+')'
    if isinstance(n,ast.Call):
        name=expr(n.func); args=list(map(expr,n.args))
        if name in ('max','min'): return 'Math.'+name+'('+','.join(args)+')'
        name={'abs':'Math.abs','sum':'pythonFloatSum','bool':'Boolean','str':'pystr'}.get(name,name)
        return name+'('+','.join(args)+')'
    raise ValueError(ast.dump(n))

def statements(nodes,indent='  '):
    out=[]
    for n in nodes:
        if isinstance(n,ast.Assign): out.append(indent+'const '+expr(n.targets[0])+'='+expr(n.value)+';')
        elif isinstance(n,ast.Expr): out.append(indent+expr(n.value)+';')
        elif isinstance(n,ast.For): out += [indent+'for(const '+expr(n.target)+' of '+expr(n.iter)+') {',*statements(n.body,indent+'  '),indent+'}']
        else: raise ValueError(ast.dump(n))
    return out
begin=next(i for i,n in enumerate(main.body) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='gdp25' for t in n.targets))
finish=next(i for i,n in enumerate(main.body) if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='mock_cmp' for t in n.targets))
body=statements(main.body[begin:finish])
consts={'gdp26':130.4,'gdp27':141.4,'mock_cmp':{},'sha':'SHA','PDF':Path('data/originals/budget_2027/Draft_Budgetary_Plan_of_the_Republic_of_Bulgaria_for_2027.pdf'),'ROOT':Path('.'),'FIG':[],'DER':[],'CHECKS':[]}
for n in main.body:
    if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id in ('BASES','basis_diff','not_in_doc','caveats','doc_meta','out'):
        exec(compile(ast.Module([n],[]),'<donor-editorial>','exec'),consts)
template=consts['out'];template.pop('figures');template.pop('derived');template.pop('checks')
print('// Transcribed from extract/dbp2027.py declarations, not expectedfigures.json.\n// Regenerate: test/publication-documents-generate-dbp.py <immutable donor>.')
print("import { pythonFloatSum } from '../../common/numbers.js';")
print('export const dbpSpecifications = '+json.dumps(specs,ensure_ascii=False,indent=2)+' as const;')
print('export const dbpEditorial = '+json.dumps(template,ensure_ascii=False,indent=2)+';')
print('export function dbpCalculations(V:any, t7:unknown, derived:(...args:any[])=>void, check:(name:string,ok:boolean,detail:string)=>void, fixed:(v:number,n:number)=>string, pystr:(v:any)=>string) {')
print('\n'.join(body));print('  return {gdp26,gdp27};\n}')
