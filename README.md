# CRM Motomecânica Volkswagen

CRM interno para controle de vendas, clientes, propostas, comissões, metas e integrações (Instagram, FIPE, Banco VW) da concessionária.

## Estrutura do projeto

```
crm-volkswagen/
│
├── index.html          # Estrutura HTML da aplicação
├── css/
│   └── style.css       # Todo o estilo visual do sistema
├── js/
│   ├── app.js           # Estado global, bootstrap e "fiação" (event listeners, inicialização)
│   ├── auth.js           # Login/logout e sessão do vendedor
│   ├── supabase.js       # Conexão, sincronização e persistência (nuvem + backup local)
│   ├── vendedores.js      # Cadastro e gestão de vendedores
│   ├── clientes.js        # Painel de clientes e pedidos
│   ├── propostas.js       # Simulador de propostas, taxas e comissões
│   ├── estoque.js         # Consulta de tabela FIPE
│   ├── crm.js             # Dashboard, controle diário, vendas, gerente smart, banco VW, config, etc.
│   └── utils.js           # Funções utilitárias (datas, formatação, gráficos SVG)
├── assets/               # Reservado para imagens/ícones externos ao HTML (atualmente vazio)
├── README.md
└── .gitignore
```

## Sobre esta organização

Este projeto era originalmente um único arquivo `index.html` (HTML + CSS + JavaScript, tudo junto). Ele foi reorganizado em múltiplos arquivos para facilitar manutenção, leitura e futuras contribuições — **sem alterar nenhuma funcionalidade, lógica de negócio, estrutura de dados ou banco (Supabase)**.

A divisão em `js/*.js` foi feita com um script auxiliar baseado em análise de sintaxe (AST), garantido por três verificações automáticas:
1. Toda declaração de função/variável do arquivo original está presente, uma única vez, em algum dos 9 arquivos.
2. A concatenação dos 9 arquivos, na ordem de carregamento usada no `index.html`, é sintaticamente idêntica ao script original.
3. A sequência de **execução imediata** (chamadas de função, `addEventListener`, inicializações que rodavam automaticamente ao carregar a página) foi preservada **exatamente na mesma ordem relativa** do arquivo original — o que é a parte mais sensível de qualquer divisão desse tipo.

Os arquivos `.js` são carregados como scripts clássicos (sem bundler, sem `type="module"`), na seguinte ordem, para preservar 100% do comportamento original:

```html
<link rel="stylesheet" href="css/style.css">
...
<script src="js/vendedores.js"></script>
<script src="js/auth.js"></script>
<script src="js/supabase.js"></script>
<script src="js/clientes.js"></script>
<script src="js/propostas.js"></script>
<script src="js/estoque.js"></script>
<script src="js/utils.js"></script>
<script src="js/crm.js"></script>
<script src="js/app.js"></script>
```

`app.js` carrega por último porque contém o estado inicial (`state`, `DEFAULT_STATE`) e, ao final, toda a "fiação" do sistema (listeners de botões, `renderAll()`, o boot de login) — isso garante que todas as funções dos outros arquivos já existem no momento em que são chamadas.

## Como rodar localmente

Este projeto não usa build, bundler ou Node.js em produção — é só abrir o `index.html` num navegador. Para testar localmente com um servidor simples (recomendado, pois `fetch`/módulos podem ter restrições em `file://`):

```bash
# na pasta do projeto
python3 -m http.server 8000
# depois abra http://localhost:8000
```

## Publicação

O site é publicado via GitHub Pages (branch `main`, pasta raiz) e/ou Netlify. Nenhuma etapa de build é necessária — os arquivos estáticos são servidos diretamente.

## Banco de dados

O sistema usa Supabase (tabela `crm_estado`, guardando o estado do CRM em formato JSON) para sincronização entre dispositivos, e Supabase Auth para login dos vendedores. Nenhuma alteração foi feita no banco ou na estrutura do JSON durante esta reorganização.
