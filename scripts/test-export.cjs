// Exercise real renderer builders and native export IPC with an isolated library.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const JSZip = require('jszip');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-ai-export-'));
const device = path.join(scratch, 'device'), libraryDir = path.join(scratch, 'library');
fs.mkdirSync(device); fs.mkdirSync(path.join(libraryDir, 'book-one', 'chapters'), { recursive: true });
fs.writeFileSync(path.join(device, 'settings.json'), JSON.stringify({ libraryDir }));
const verse = '<p style="text-align:justify">Unmarked verse<br>    <i>Indented verse</i><br>Unindented verse<br><br>Next stanza</p><pre>    First verse line\n        <i>Second verse line</i>\n  Third verse line</pre>';
const fixture = '<h2>A turning point</h2><p style="text-align:justify">A <b>bold</b> and <i>quiet</i> arrival. <u>Underlined</u> <s>struck</s><br>Second line.</p><ol start="3"><li>Third clue<ul><li>Nested clue</li></ul></li><li>Fourth clue</li></ol><div>A final detail.</div>' + verse;
fs.writeFileSync(path.join(libraryDir, 'book-one', 'book.json'), JSON.stringify({ id:'book-one', title:'Export fixture', author:'Test Writer', chapterOrder:['a','b','c'], chapterTitles:{a:'Scene one',b:'Scene two',c:'Ending'}, workspaceTree:{manuscript:[{id:'folder',type:'folder',title:'Arrival',children:[{id:'a',type:'document'},{id:'b',type:'document'}]},{id:'c',type:'document'}], characters:[{id:'card',type:'document',title:'Cast',text:'PRIVATE REFERENCE'}]} }));
for (const [id, html] of Object.entries({a:fixture,b:'<p>SECOND SCENE</p>',c:'<p>ENDING SCENE</p>'})) fs.writeFileSync(path.join(libraryDir,'book-one','chapters',id+'.html'),html);
fs.writeFileSync(path.join(libraryDir, 'library.json'), JSON.stringify({firstRunDone:true,authorName:'Fixture',hintShown:true,coverArt:{auto:false},shelves:[{id:'shelf',name:'Shelf',bookIds:['book-one']}]}));
app.setPath('userData', device); process.env.NEO_TEST_HEADLESS='1';
let saves=0, cancelSave=false;
dialog.showSaveDialog = async (_win, options) => { saves++; return cancelSave ? {canceled:true} : {canceled:false,filePath:path.join(scratch,'sample.'+options.filters[0].extensions[0])}; };
require('../main');
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
let owner;
const evaluate = code => owner.webContents.executeJavaScript(code,true);
async function until(fn,label){const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await pause(40)}throw new Error('Timed out: '+label)}
app.whenReady().then(async()=>{
  await until(()=>owner=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html')),'window');
  owner.setSize(1300,950); owner.webContents.setBackgroundThrottling(false);
  await until(()=>evaluate('typeof library!=="undefined" && !!library && !!window.chooseBookExport'),'startup');
  await evaluate('openBook("book-one")');
  const records=await evaluate(`parasFromHtml(${JSON.stringify(fixture)})`);
  assert.equal(records[0].heading,2); assert.equal(records[1].align,'justify');
  assert.match(records[1].text,/struck\nSecond line/); assert.ok(records[1].runs.some(r=>r.u)); assert.ok(records[1].runs.some(r=>r.s));
  assert.deepEqual(records.filter(p=>p.list).map(p=>[p.list.number,p.list.depth]),[[3,0],[1,1],[4,0]]);
  assert.equal(records.at(-3).text,'A final detail.');
  assert.equal(records.at(-2).preserveSpacing,true);
  assert.equal(records.at(-2).poetry,undefined);
  assert.equal(records.at(-1).text,'    First verse line\n        Second verse line\n  Third verse line');
  assert.equal(await evaluate(`parasFromHtml('<p class="ghost" data-sec-id="x">ghost</p><p class="scene-break" data-sec-brk="x">***</p><p>kept<script>bad()</script></p>').map(p=>p.text).join('')`),'kept');
  await evaluate(`void doExport('txt')`);
  await until(()=>evaluate('document.querySelector("#manuscript-export-dialog").open'),'dialog');
  assert.equal(await evaluate('document.querySelectorAll("[data-documents] input:checked").length'),3);
  await evaluate('document.querySelector("[data-action=none]").click()');
  assert.equal(await evaluate('document.querySelector("[data-action=export]").disabled'),true);
  await evaluate('document.querySelector("[data-action=manuscript]").click(); document.querySelector("#manuscript-export-dialog details").open=true');
  owner.showInactive(); await pause(500); fs.writeFileSync(path.join(scratch,'dialog.png'),(await owner.webContents.capturePage()).toPNG());owner.hide();
  await evaluate('document.querySelector("[data-action=cancel]").click()'); await until(()=>evaluate('!exportBusy'),'cancel');assert.equal(saves,0);
  for(const format of ['txt','md','html','docx','epub','pdf']) {
    await evaluate(`void doExport('${format}')`);await until(()=>evaluate('document.querySelector("#manuscript-export-dialog").open'),'options');
    assert.equal(await evaluate('!document.querySelector("[data-pagination]").hidden'), ['pdf','docx'].includes(format));
    assert.equal(await evaluate('document.querySelector("[data-page-numbers]").checked'), false);
    // Omit the final document; included scenes must retain folder order.
    await evaluate('document.querySelector("[data-documents] input[value=c]").click();document.querySelector("[data-action=export]").click()');
    await until(()=>evaluate('!exportBusy'),format+' saved');
    assert.ok(fs.existsSync(path.join(scratch,'sample.'+format)),format);
  }
  const txt=fs.readFileSync(path.join(scratch,'sample.txt'),'utf8');
  assert.ok(txt.includes('        First verse line\n            Second verse line\n      Third verse line'), 'TXT preserves relative poetry indentation on every line');
  assert.match(txt,/ARRIVAL/);assert.match(txt,/3\. Third clue/);assert.match(txt,/SECOND SCENE/);assert.doesNotMatch(txt,/PRIVATE REFERENCE|ENDING SCENE/);
  const html=fs.readFileSync(path.join(scratch,'sample.html'),'utf8').replace(/data:image[^"]+/g, '[cover]');assert.match(html,/<h2 class="text-heading">A turning point/);assert.match(html,/<u>Underlined<\/u>/);assert.match(html,/<s>struck<\/s>/);assert.match(html,/<br\s*\/?>Second line/);assert.match(html,/<ol start="3"/);
  const md=fs.readFileSync(path.join(scratch,'sample.md'),'utf8');assert.match(md,/#### A turning point/);assert.match(md,/\*\*bold\*\*/);assert.match(md,/~~struck~~/);
  for(const format of ['docx','epub']) {
    const zip=await JSZip.loadAsync(fs.readFileSync(path.join(scratch,'sample.'+format)));
    const entries={};for(const [name,file] of Object.entries(zip.files))if(/\.(xml|rels|opf|ncx|xhtml)$/.test(name))entries[name]=await file.async('string');
    for(const [name,xml] of Object.entries(entries))assert.equal(await evaluate(`new DOMParser().parseFromString(${JSON.stringify(xml)}, 'application/xml').querySelector('parsererror')?.textContent || ''`),'',name);
    if(format==='docx'){const xml=entries['word/document.xml'];assert.match(xml,/<w:u /);assert.match(xml,/<w:strike\/>/);assert.match(xml,/<w:br\/>/);assert.match(xml,/Heading3/);assert.match(xml,/w:val="both"/);assert.match(entries['word/numbering.xml'],/w:start w:val="3"/);assert.equal(entries['word/footer.xml'],undefined);assert.doesNotMatch(xml,/footerReference/);}
    else {assert.match(entries['OEBPS/nav.xhtml'],/>Arrival</);assert.match(entries['OEBPS/ch1.xhtml'],/<u>Underlined/);assert.equal(Object.keys(entries).filter(n=>/ch\d+\.xhtml/.test(n)).length,1);}
  }
  const preview=new BrowserWindow({show:false,webPreferences:{sandbox:true}});await preview.loadFile(path.join(scratch,'sample.html'));preview.setSize(1000,1000);preview.showInactive();await pause(500);
  async function checkVerse(window) {
    const hardLines = await window.webContents.executeJavaScript(`(() => {
      const paragraph = [...document.querySelectorAll('p')].find(p => p.textContent.includes('Unmarked verse'));
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT), positions = [];
      while(walker.nextNode()) {
        const node = walker.currentNode, index = node.textContent.search(/Indented verse|Unindented verse/);
        if(index < 0) continue;
        const range = document.createRange(); range.setStart(node,index); range.setEnd(node,index+1);
        positions.push(range.getBoundingClientRect().x);
      }
      return positions;
    })()`);
    assert.equal(hardLines.length,2);
    assert.ok(hardLines[0] > hardLines[1], 'Indented hard lines survive in ordinary paragraphs too');
    const offsets = await window.webContents.executeJavaScript(`(() => {
      const verse = [...document.querySelectorAll('p.poetry')].find(p => p.textContent.includes('First verse line'));
      const positions = [];
      const walker = document.createTreeWalker(verse, NodeFilter.SHOW_TEXT);
      while(walker.nextNode()) {
        const node = walker.currentNode, index = node.textContent.search(/First|Second|Third/);
        if(index < 0) continue;
        const range = document.createRange(); range.setStart(node,index); range.setEnd(node,index+1);
        positions.push(range.getBoundingClientRect().x);
      }
      return positions;
    })()`);
    assert.equal(offsets.length,3);
    assert.ok(offsets[1] > offsets[0] && offsets[0] > offsets[2], 'Verse lines retain different visible indents');
  }
  await checkVerse(preview);
  const epub = await JSZip.loadAsync(fs.readFileSync(path.join(scratch,'sample.epub')));
  const epubPreview = new BrowserWindow({show:false,webPreferences:{sandbox:true}});
  const chapter = await epub.file('OEBPS/ch1.xhtml').async('string');
  const css = await epub.file('OEBPS/style.css').async('string');
  await epubPreview.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(chapter.replace('</head>','<style>'+css+'</style></head>')));
  await checkVerse(epubPreview); epubPreview.destroy();
  await preview.webContents.executeJavaScript('document.querySelector(".chapter").scrollIntoView()');await pause(200);fs.writeFileSync(path.join(scratch,'html.png'),(await preview.webContents.capturePage()).toPNG());preview.destroy();
  assert.equal(fs.readFileSync(path.join(scratch,'sample.pdf')).subarray(0,5).toString(),'%PDF-');
  cancelSave=true;await evaluate("void doExport('txt')");await until(()=>evaluate('document.querySelector("#manuscript-export-dialog").open'),'cancel save');await evaluate('document.querySelector("[data-action=export]").click()');await until(()=>evaluate('!exportBusy'),'native cancel');
  cancelSave=false;
  await evaluate(`openWorkspaceNode('characters','card');const editor=document.querySelector('.tree-document-text');editor.innerHTML='<h3>LIVE REFERENCE EDIT</h3>';editor.dispatchEvent(new Event('input',{bubbles:true}));void doExport('txt')`);
  await until(()=>evaluate('document.querySelector("#manuscript-export-dialog").open'),'reference options');
  await evaluate(`document.querySelector('[data-action=none]').click();document.querySelector('[data-documents] input[value=card]').click();document.querySelector('[data-headings]').value='documents';document.querySelector('[data-action=export]').click()`);
  await until(()=>evaluate('!exportBusy'),'live reference saved');
  const reference=fs.readFileSync(path.join(scratch,'sample.txt'),'utf8');assert.match(reference,/CAST/);assert.match(reference,/LIVE REFERENCE EDIT/);assert.doesNotMatch(reference,/SECOND SCENE/);
  fs.copyFileSync(path.join(scratch,'sample.pdf'),path.join(scratch,'unnumbered.pdf'));
  await evaluate(`switchTab('manuscript');const body=document.querySelector('.chapter[data-id="a"] .chapter-body');body.innerHTML=${JSON.stringify(fixture)}+'<p>This paragraph tests consecutive page numbers across a long chapter and its page breaks.</p>'.repeat(70);body.dispatchEvent(new Event('input',{bubbles:true}))`);
  for (const format of ['pdf','docx']) {
    await evaluate(`void doExport('${format}')`);await until(()=>evaluate('document.querySelector("#manuscript-export-dialog").open'),'numbered options');
    await evaluate('document.querySelector("[data-page-numbers]").click()');
    if(format==='pdf'){owner.showInactive();await pause(400);fs.writeFileSync(path.join(scratch,'pagination-dialog.png'),(await owner.webContents.capturePage()).toPNG());owner.hide();}
    await evaluate('document.querySelector("[data-action=export]").click()');await until(()=>evaluate('!exportBusy'),'numbered '+format);
    fs.copyFileSync(path.join(scratch,'sample.'+format),path.join(scratch,'numbered.'+format));
  }
  const word=await JSZip.loadAsync(fs.readFileSync(path.join(scratch,'numbered.docx')));
  const footer=await word.file('word/footer.xml').async('string'), documentXml=await word.file('word/document.xml').async('string');
  assert.match(footer,/w:instr=" PAGE "/);assert.match(footer,/w:jc w:val="center"/);assert.match(documentXml,/w:pgNumType w:fmt="decimal" w:start="1"/);
  assert.equal((documentXml.match(/<w:sectPr>/g)||[]).length,2);
  assert.doesNotMatch(documentXml.split('</w:sectPr>')[0],/footerReference/);
  for(const file of Object.values(word.files))if(/\.(xml|rels)$/.test(file.name))assert.equal(await evaluate(`new DOMParser().parseFromString(${JSON.stringify(await file.async('string'))}, 'application/xml').querySelector('parsererror')?.textContent || ''`),'',file.name);
  await evaluate(`book.workspaceTree.manuscript[0].title='Chapter 1 — Arrival';book.chapterTitles.c='Chapter II — Ending';renderChapters()`);
  for (const style of ['roman','arabic']) for (const format of ['txt','md','html','docx','epub','pdf']) {
    await evaluate(`void doExport('${format}')`);await until(()=>evaluate('document.querySelector("#manuscript-export-dialog").open'),'chapter numbering options');
    assert.equal(await evaluate('document.querySelector("[data-numbering]").value'),'named');
    await evaluate(`document.querySelector('[data-numbering]').value='${style}';document.querySelector('[data-numbering]').dispatchEvent(new Event('change'));document.querySelector('#manuscript-export-dialog details').open=true`);
    const expected=style==='roman' ? ['Chapter I — Arrival','Chapter II — Ending'] : ['Chapter 1 — Arrival','Chapter 2 — Ending'];
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-preview] li')].map(n=>n.textContent.split(' — Scene')[0].split(' — Chapter')[0])`),expected);
    if(style==='roman' && format==='pdf') {
      await evaluate(`const headings=document.querySelector('[data-headings]');headings.value='none';headings.dispatchEvent(new Event('change'))`);
      assert.equal(await evaluate('document.querySelector("[data-numbering]").disabled'),true);
      await evaluate(`document.querySelector('[data-headings]').value='folders';document.querySelector('[data-headings]').dispatchEvent(new Event('change'));document.querySelector('[data-page-numbers]').click()`);
      assert.equal(await evaluate('document.querySelector("[data-numbering]").disabled'),false);
      owner.showInactive();await pause(400);fs.writeFileSync(path.join(scratch,'chapter-numbering-dialog.png'),(await owner.webContents.capturePage()).toPNG());owner.hide();
    }
    await evaluate('document.querySelector("[data-action=export]").click()');await until(()=>evaluate('!exportBusy'),style+' '+format);
    fs.copyFileSync(path.join(scratch,'sample.'+format),path.join(scratch,style+'.'+format));
    let content;
    if(['docx','epub'].includes(format)) {
      const zip=await JSZip.loadAsync(fs.readFileSync(path.join(scratch,style+'.'+format)));
      content=await zip.file(format==='docx'?'word/document.xml':'OEBPS/nav.xhtml').async('string');
      if(format==='epub') for(const name of ['OEBPS/ch1.xhtml','OEBPS/ch2.xhtml','OEBPS/toc.ncx']) {
        const xml=await zip.file(name).async('string');
        assert.equal(await evaluate(`new DOMParser().parseFromString(${JSON.stringify(xml)}, 'application/xml').querySelector('parsererror')?.textContent || ''`),'',name);
        assert.ok(expected.some(title=>xml.includes(title)),name);
      }
    } else if(format!=='pdf') content=fs.readFileSync(path.join(scratch,style+'.'+format),'utf8');
    if(content) for(const title of expected) assert.ok(content.toUpperCase().includes(title.toUpperCase()),style+' '+format+' '+title);
  }
  assert.deepEqual(await evaluate('[book.workspaceTree.manuscript[0].title,book.chapterTitles.c]'),['Chapter 1 — Arrival','Chapter II — Ending']);
  console.log('PASS: selection, folder order, scene breaks, six export formats, rich formatting, visible poetry indentation, page numbers, Roman/Arabic chapter numbering, XML validity, cancellation.');console.log('Artifacts: '+scratch);app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
setTimeout(()=>{console.error('Export test timed out');app.exit(1)},120000).unref();
