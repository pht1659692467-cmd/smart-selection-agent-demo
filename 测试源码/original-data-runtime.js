const originalDemoData = __ORIGINAL_DEMO_DATA__;
window.originalDemoData = originalDemoData;
Object.assign(customerProfileExamples, originalDemoData.profiles);
function isPreparedDemo(){return activeConversationId === 'new' || String(activeConversationId||'').startsWith('new_');}
function demoGenerateCommand(text){return /生成(?:选品)?方案|方案生成/.test(String(text));}
function demoItemFor(cat){return demandState.demoItems?.find(item=>/鞋/.test(cat)?/鞋/.test(item.category):/外套/.test(item.category));}
function demoItemUnit(cat){return /鞋/.test(cat)?'双':'件';}
function demoOrderBudget(){
  const b=demandState.demoBudget,items=demandState.demoItems||[];
  if(!b||!(b.amount>0)||b.kind==='ambiguous')return null;
  if(b.kind==='order')return b.amount;
  if(items.length<2||!items.every(i=>Number(i.qty)>0&&Number(i.qty)===Number(items[0].qty)))return null;
  return Math.round(b.amount*Number(items[0].qty)*100)/100;
}
function demoParseBudget(text){
  const m=text.match(/(整单(?:总)?预算|整单(?:合计)?|每套(?:预算|上限)?|每人(?:预算)?|总预算|总共预算)\s*(?:为|是|不超过|最多|上限|[:：])?\s*(-?\d+(?:\.\d+)?)\s*(万)?\s*元?/);
  if(m)demandState.demoBudget={kind:/整单/.test(m[1])?'order':/每套|每人/.test(m[1])?'set':'ambiguous',amount:Number(m[2])*(m[3]?10000:1)};
  else if(demandState.demoBudget?.kind==='ambiguous'){
    if(/整单|整笔|全部商品/.test(text))demandState.demoBudget.kind='order';
    else if(/每套|每人/.test(text))demandState.demoBudget.kind='set';
  }
  if(/改为(?:各品|独立)|取消总预算/.test(text))demandState.demoBudget=null;
}
function demoAllocateBudget(){
  const items=demandState.demoItems||[],total=demoOrderBudget();
  if(!demandState.demoBudget)return;
  // Clear only derived caps: an explicit per-category cap always keeps priority.
  for(const i of items)i.price=demandState.demoExplicitPrices?.[i.category]||'';
  if(total===null||!items.every(i=>Number(i.qty)>0))return;
  const pending=items.filter(i=>!i.price),fixed=items.filter(i=>i.price).reduce((s,i)=>s+Number(i.price)*Number(i.qty),0);
  const remaining=Math.max(0,total-fixed);
  if(!pending.length){demandState.demoAllocationSource='用户指定';return;}
  const customer=conversations.find(c=>c.id===activeConversationId)?.customerId;
  const ratios=originalDemoData.profiles[customer]?.packageBudgetRatios;
  const history=ratios&&pending.every(i=>Number(ratios[i.category])>0);
  const simulated=originalDemoData.budgetDecisionAvailable!==false;
  demandState.demoAllocationSource=history?'类似套装历史比例（演示）':simulated?'候选价格分布（规则模拟AI）':'均分兜底（AI不可用）';
  const weights=pending.map(i=>{
    if(history)return Number(ratios[i.category]);
    if(!simulated)return 1;
    const prices=originalDemoData.products.filter(p=>p.category===i.category).map(demoQuote).sort((a,b)=>a-b);
    if(!prices.length)return 1;
    const mid=Math.floor(prices.length/2),median=prices.length%2?prices[mid]:(prices[mid-1]+prices[mid])/2;
    return median*Number(i.qty);
  });
  const sum=weights.reduce((s,v)=>s+v,0);
  pending.forEach((i,n)=>i.price=String(Math.floor(remaining*weights[n]/sum/Number(i.qty)*100+1e-7)/100));
}
function demoBudgetText(state=demandState){
  const b=state.demoBudget;
  if(!b)return '各品独立预算';
  return (b.kind==='order'?'整单总预算':b.kind==='set'?'每套预算':'预算口径待确认')+b.amount+'元'+(state.demoAllocationSource?'；分配依据：'+state.demoAllocationSource:'');
}
function demoBudgetField(cat){const i=demoItemFor(cat);return (i?.price?i.price+'元':'未填')+(demandState.demoBudget?'（'+demoBudgetText()+'）':'');}
function demoGroupCost(index,replaceRow=-1,replacement=null,setIndex=null){
  const si=setIndex??demoActiveSet(index);
  const products=isMultiPlan()?demoSetProducts(index,si):demoGroups()[index].ids.map(id=>originalDemoData.products.find(p=>p.id===id));
  return products.reduce((sum,p,row)=>{p=row===replaceRow?replacement:p;return sum+demoQuote(p)*demoRowQuantity(row,p.category);},0);
}

function demoMissingP0(){
  const missing=[];
  if(demandState.demoPackagePending)missing.push('套装组成（具体包含哪些品类）');
  if(isPreparedDemo()&&isMultiPlan()&&!(demandState.demoItems?.length>1))missing.push('各品具体数量和独立供货价上限');
  if(isPreparedDemo()&&demandState.demoItems?.length>1){
    demandState.demoItems.forEach(item=>{if(!(Number(item.qty)>0))missing.push(item.category+'的具体数量');if(!demandState.demoBudget&&!(Number(item.price)>0))missing.push(item.category+'的独立供货价上限或套装总预算');});
    const b=demandState.demoBudget;
    if(b?.kind==='ambiguous')missing.push('总预算口径（整单还是每套）');
    if(b&&!(b.amount>0))missing.push('大于0的预算');
    if(b?.kind==='set'&&demandState.demoItems.every(i=>Number(i.qty)>0)&&demoOrderBudget()===null)missing.push('每套组成和套数（各品数量不相等）');
  }else{
    if(!demandState.category)missing.push('商品品类');
    if(!(Number(demandState.qty)>0))missing.push('需求数量（大于0）');
    if(!(Number(demandState.price)>0))missing.push('供货价上限（大于0）');
  }
  if(!demandState.gender)missing.push('性别要求');
  return missing;
}
function demoP0Question(){
  const items=demandState.demoItems||[],questions=[];
  if(demandState.demoPackagePending)questions.push('套装具体包含哪些品类？请先确认套装组成。');
  if(items.length>1){
    const q=items.filter(i=>!(Number(i.qty)>0)),p=items.filter(i=>!(Number(i.price)>0));
    if(q.length)questions.push('请分别提供数量：'+q.map(i=>i.category+'多少'+demoItemUnit(i.category)).join('、')+'？');
    if(!demandState.demoBudget&&p.length)questions.push('可以给各品独立预算：'+p.map(i=>i.category+'每'+demoItemUnit(i.category)+'供货价上限').join('、')+'；也可以给整单总预算或每套预算。');
    const b=demandState.demoBudget;
    if(b?.kind==='ambiguous')questions.push('您说的总预算'+b.amount+'元，是整单还是每套？');
    if(b&&!(b.amount>0))questions.push('请提供大于0的预算。');
    if(b?.kind==='set'&&items.every(i=>Number(i.qty)>0)&&demoOrderBudget()===null)questions.push('各品数量不相等，请明确每套组成、套数及剩余单品的预算；也可改为整单总预算。');
    if(!demandState.gender)questions.push('本次性别要求是什么？');
  }else questions.push(...demoMissingP0().filter(s=>!s.startsWith('套装组成')).map(s=>'请补充'+s+'。'));
  return '当前P0尚未齐全，暂不能生成方案。\n'+questions.slice(0,3).map(q=>'• '+q).join('\n');
}
function demoGroups(){return isMultiPlan()?originalDemoData.packagePlans:originalDemoData.strategies;}

function demoGroupEligible(index){
  if(isMultiPlan())return demoQualifiedSets(index).length>0;
  const group=demoGroups()[index];if(!group)return false;
  const brands=(demandState.brand||'').split(/[、,，/]/).filter(b=>b&&b!=='不限');
  return group.ids.every((id,row)=>{const p=originalDemoData.products.find(p=>p.id===id),qty=demoRowQuantity(row,p.category);return (!brands.length||brands.includes(p.brand))&&demoQuote(p)<=Number(demandState.price)&&p.mainSizes.every((size,i)=>p.stocks[size]>=Math.floor(qty/p.mainSizes.length)+(i<qty%p.mainSizes.length?1:0));});
}

function demoQualifiedGroups(){return demoGroups().map((_,i)=>i).filter(demoGroupEligible);}
function demoStrategy(){const requested=Number(demoConversation()?.demoStrategyIndex||0),valid=demoQualifiedGroups();return valid.includes(requested)?requested:(valid[0]??0);}

function demoRowQuantity(row,cat='跑鞋'){const multi=isMultiPlan(),qty=Number(multi?demoItemFor(cat)?.qty||0:demandState.qty||300),slots=multi?2:3,index=multi?Math.floor(row/2):row;return Math.floor(qty/slots)+(index<qty%slots?1:0);}
function demoQuote(product){const c=conversations.find(c=>c.id===activeConversationId);return originalDemoData.customerPrices[c?.customerId]?.[product.id]??product.price;}
function demoProductFor(cat,setIndex,row){
  if(!isPreparedDemo()||(!isMultiPlan()&&!/鞋/.test(cat)))return null;
  if(isMultiPlan())return demoSetProducts(demoStrategy(),setIndex)[row]||null;
  const id=originalDemoData.strategies[demoStrategy()].ids[row%3];return originalDemoData.products.find(p=>p.id===id);
}

function demoSizeMarkup(product,qty){
  const sizes=product.mainSizes;
  return sizes.map((size,i)=>{
    const need=Math.floor(qty/sizes.length)+(i<qty%sizes.length?1:0),stock=product.stocks[size]||0;
    return `<div class="plan-size ${stock<need?'warn':''} ${!stock?'disabled':''}"><b>${esc(size)}码</b><span>需${need}/库存${stock}</span><small>库存${stock}</small></div>`;
  }).join('');
}
function demoSummary(index){
  if(isMultiPlan()){
    const valid=demoQualifiedSets(index),totals=valid.map(si=>demoGroupCost(index,-1,null,si));
    return `${demoGroups()[index].name}：内含${valid.length}套可选组合；${valid.map((si,n)=>'套装'+(n+1)+' '+demoSets(index)[si].name+' '+totals[n].toFixed(2)+'元').join('；')}。每套均覆盖跑鞋${demoItemFor('跑鞋')?.qty}双＋外套${demoItemFor('外套')?.qty}件，独立满足预算；各套为备选，不累计金额。`;
  }
  const strategy=demoGroups()[index],cards=index===demoStrategy()?[...planResult.querySelectorAll('.single-set .plan-product')]:[];
  const ps=strategy.ids.map((id,row)=>originalDemoData.products.find(p=>p.id===(cards[row]?.dataset.demoId||id))),prices=ps.map(demoQuote);
  const total=ps.reduce((n,p,row)=>n+demoQuote(p)*demoRowQuantity(row,p.category),0);
  return `${strategy.name}：套间按品牌差异化，套内比较经典/新款/轻量款；3款跑鞋合计${demandState.qty||300}双，总价${total.toFixed(2)}元；供货价${Math.min(...prices)}～${Math.max(...prices)}元，均覆盖主销码。`;
}

function demoFillCard(card,product,row){
  if(!card||!product)return;
  const qty=demoRowQuantity(row,product.category),price=demoQuote(product);
  card.dataset.demoId=product.id;card.dataset.demoRow=row;card.dataset.qty=qty;card.dataset.price=price;
  card.querySelector('.plan-name').textContent=product.name;
  card.querySelector('.plan-sku span').textContent='货号：'+product.sku;
  const tag=card.querySelector('.plan-tag.neutral');if(tag)tag.textContent=product.brand;
  const warehouseTag=card.querySelector('.plan-tag:not(.neutral)');if(warehouseTag)warehouseTag.textContent=product.warehouse.includes('主推')?'主推':'内仓';
  const ship=card.querySelector('.plan-ship-tag');if(ship)ship.textContent=product.warehouse+' · '+qty+(product.unit||'双');
  card.querySelector('.plan-thumb').style.backgroundImage=product.thumbnail?'url("'+product.thumbnail+'")':'';
  card.querySelector('.plan-sizes').innerHTML=demoSizeMarkup(product,qty);
  const values=card.querySelectorAll('.plan-value');if(values[0])values[0].textContent='¥'+product.listPrice;if(values[1])values[1].textContent=(price/product.listPrice*10).toFixed(1)+'折';if(values[2])values[2].textContent='¥'+price;
}
function hydrateDemoPlanData(refreshRows=false){
  if(!isPreparedDemo()||(!isMultiPlan()&&!/鞋/.test(demandState.category||'')))return;
  const pi=demoStrategy(),valid=demoQualifiedGroups(),sets=isMultiPlan()?demoQualifiedSets(pi):[0],si=isMultiPlan()?demoActiveSet(pi):0;
  const list=planResult.querySelector?.('.plan-list');if(list){list.dataset.demoPlanIndex=pi;list.dataset.demoConversationId=activeConversationId;}
  planResult.querySelectorAll('.plan-set-panel').forEach(panel=>{
    const setIndex=Number(panel.dataset.setIndex||0),saved=isMultiPlan()?demoSavedSet(pi,setIndex):null;
    panel.style.display=isMultiPlan()&&!sets.includes(setIndex)?'none':'';
    panel.querySelectorAll('.plan-product').forEach((card,row)=>{
      const p=isMultiPlan()?demoSetProducts(pi,setIndex)[row]:!refreshRows&&originalDemoData.products.find(p=>p.id===card.dataset.demoId)||demoProductFor(card.dataset.cat,setIndex,row);
      demoFillCard(card,p,row);
      if(isMultiPlan()){
        const checked=saved?.rows?.[row]?.checked??setIndex<2;
        card.querySelector('.plan-card-check')?.classList.toggle('on',checked);card.classList.toggle('dimmed',!checked);
      }
    });
    if(isMultiPlan()){
      panel.classList.toggle('active',setIndex===si);
      const label=panel.querySelector('.plan-set-label');if(label?.lastChild?.nodeType===3)label.lastChild.textContent='套装'+(sets.indexOf(setIndex)+1);
      if(sets.includes(setIndex))syncSetCheck(panel);
    }
  });
  planResult.querySelectorAll('.plan-priority-card').forEach((card,i)=>{card.style.display=valid.includes(i)?'':'none';card.querySelector('.plan-priority-copy').textContent=demoSummary(i);card.classList.toggle('active',i===pi);});
  planResult.querySelectorAll('.plan-package-tab').forEach((tab,i)=>{tab.style.display=sets.includes(i)?'':'none';tab.textContent='套装'+(sets.indexOf(i)+1);tab.classList.toggle('active',i===si);});
  const subtitle=planResult.querySelector('.plan-package-subtitle');if(subtitle)subtitle.textContent=demoGroups()[pi].name+' · '+demoSets(pi)[si]?.name+' · 本方案'+sets.length+'套可选；套间品牌、套内新旧＋价格档';
}

function selectDemoStrategy(index){
  if(!isPreparedDemo()||!demoGroupEligible(index))return;
  demoCaptureVisibleSets();const c=demoConversation();if(c)c.demoStrategyIndex=index;
  hydrateDemoPlanData(true);updatePlanSummary();
}

function swapDemoProduct(card){
  if(!isPreparedDemo()||!card?.dataset.demoId)return false;
  demoCaptureVisibleSets();const row=Number(card.dataset.demoRow||0),pi=demoStrategy(),si=isMultiPlan()?demoActiveSet(pi):0;
  const ids=originalDemoData.swapGroups.find(pair=>pair.includes(card.dataset.demoId))||[card.dataset.demoId],pool=ids.map(id=>originalDemoData.products.find(p=>p.id===id));
  const next=pool[(pool.findIndex(p=>p.id===card.dataset.demoId)+1)%pool.length],price=demoQuote(next),qty=demoRowQuantity(row,next.category),cap=Number(demoItemFor(next.category)?.price||demandState.price);
  if(isMultiPlan()&&demoOrderBudget()!=null&&demoGroupCost(pi,row,next,si)>demoOrderBudget()+0.001){showToast('替换后超过整单预算，未替换');return true;}
  const brand=isMultiPlan()?demoSets(pi)[si].brand:demoGroups()[pi].brand;
  if(next.brand!==brand||price>cap||next.mainSizes.some((size,i)=>next.stocks[size]<Math.floor(qty/5)+(i<qty%5?1:0))){showToast('该商品已是最合适的选项');return true;}
  demoFillCard(card,next,row);demoCaptureVisibleSets();hydrateDemoPlanData();updatePlanSummary();showToast('已替换为同类候选商品');return true;
}

function supplementOriginalDemoDemand(text){
  if(!isPreparedDemo())return;
  const t=String(text),shoe=t.match(/运动鞋|跑步鞋|跑鞋|鞋/),coat=t.match(/运动外套|冬季外套|外套|夹克/);
  demoParseBudget(t);
  if(/只买跑鞋|只要跑鞋|改为单品/.test(t)){demandState.demoItems=null;demandState.demoBudget=null;demandState.demoExplicitPrices=null;demandState.demoPackagePending=false;demandState.category='跑鞋';demandState.productRaw='跑鞋';}
  else if((shoe&&coat)||demandState.demoItems?.length>1||isMultiPlan()||demandState.demoPackagePending||/套装|两件套/.test(t)){
    const previous=(demandState.demoItems||[]).map(i=>({...i}));
    if(!previous.length&&isMultiPlan())categoryList().forEach(cat=>previous.push({category:/鞋/.test(cat)?'跑鞋':/外套|夹克/.test(cat)?'外套':cat,qty:'',price:''}));
    const markers=Array.from(t.matchAll(/运动鞋|跑步鞋|跑鞋|鞋|运动外套|冬季外套|外套|夹克/g),m=>({category:/鞋/.test(m[0])?'跑鞋':'外套',index:m.index,length:m[0].length}));
    for(let i=0;i<markers.length;i++){
      const marker=markers[i],segment=t.slice(marker.index+marker.length,markers[i+1]?.index??t.length).split(/整单|每套|每人|总预算|总共预算/)[0];
      let item=previous.find(p=>p.category===marker.category);if(!item){item={category:marker.category,qty:'',price:''};previous.push(item);}
      const qty=segment.match(/(-?\d+)\s*(?:双|件)/),before=t.slice(i?markers[i-1].index+markers[i-1].length:0,marker.index).match(/(-?\d+)\s*(?:双|件)\s*$/);
      const price=segment.match(/(?:每双|每件|供货价|上限|预算|拿货价)[^\d-]*(-?\d+(?:\.\d+)?)/)||segment.match(/(-?\d+(?:\.\d+)?)\s*元/);
      if(qty||before)item.qty=(qty||before)[1];if(price){item.price=price[1];(demandState.demoExplicitPrices??={})[marker.category]=price[1];}
    }
    demandState.demoItems=previous;
    demandState.demoPackagePending=previous.length<2;
    demoAllocateBudget();
    demandState.demoBudgetMode=demandState.demoBudget?.kind||'independent';
    if(previous.length){demandState.category=previous.map(i=>i.category).join('、');demandState.productRaw=previous.map(i=>i.category).join('+');demandState.qty=previous[0].qty||'';demandState.price=previous.length>1&&previous.every(i=>Number(i.price)>0)?String(previous.reduce((n,i)=>n+Number(i.price),0)):'';}
  }
  if(/品牌不限|不限品牌/.test(text))demandState.brand='不限';
  const lead=String(text).match(/(\d+)天内(?:到货|交货|交付)?/);if(lead)demandState.lead=lead[1]+'天内到货';
  if(/主销码/.test(text))demandState.size='主销码集中';
}
function originalDemoReply(text,fromForm){
  if(!p0Ready())return demoP0Question();
  if(demandState.demoItems?.length>1)return '已记录：'+demandState.demoItems.map(i=>i.category+i.qty+demoItemUnit(i.category)+'，每'+demoItemUnit(i.category)+(demandState.demoExplicitPrices?.[i.category]?'供货价上限':'分配上限')+i.price+'元').join('；')+'。'+demoBudgetText()+(demandState.demoBudget?.kind==='set'?'；按每套1双鞋＋1件外套、'+demandState.demoItems[0].qty+'套折算整单'+demoOrderBudget()+'元':'')+'，P0已满足，可以输入“生成方案”或点击原按钮。';
  const qty=demandState.qty||'待定',category=demandState.productRaw||'跑鞋';
  if(!demandState.price)return `已记录：${qty}双${category}。请问本次每双拿货价上限是多少？`;
  if(!demandState.brand||!demandState.invoice)return `已记录：${qty}双${category}，每双供货价不超过${demandState.price}元。品牌有偏好吗？开票需要专票还是普票？`;
  const answer=`已记录：${qty}双${category}，供货价上限${demandState.price}元，品牌${demandState.brand==='不限'?'不限':demandState.brand}，${demandState.invoice}，${demandState.size}${demandState.lead?'，'+demandState.lead:''}。核心条件已齐备，可以点击“生成选品方案”或输入“生成方案”。`;
  return fromForm?demandSummary()+'\n\n'+answer:answer;
}
let demoSourceProduct=null;
const demoOriginalSourceSizes=sourceSizes.map(s=>[...s]);
function prepareDemoSourceSizes(){const sizes=demoSourceProduct?.unit==='件'?demoSourceProduct.mainSizes.map(s=>[s,s]):demoOriginalSourceSizes;sourceSizes.splice(0,sourceSizes.length,...sizes.map(s=>[...s]));}
function demoSourceStock(index,size){return demoSourceProduct?.sources[index]?.stocks[size]??40;}
function demoSourceInfo(index){
  const product=demoSourceProduct,source=product.sources[index],price=demoQuote(product),stock=Object.values(source.stocks).reduce((a,b)=>a+b,0);
  return `<div class="source-name">${esc(source.name)}</div><div class="source-price-line">供货价 <span class="source-price">¥${price}起</span> <span class="source-old">¥${product.listPrice}</span></div><div class="source-price-line">折扣 <span class="source-discount">${(price/product.listPrice*10).toFixed(1)}折</span></div><div class="source-price-line source-stock">库存 <span>${stock}件</span></div>`;
}
function demoExportSnapshot(index=demoStrategy()){
  demoCaptureVisibleSets();const c=demoConversation(),strategy=demoGroups()[Number(index)||0];
  const common={synthetic:true,note:originalDemoData.note,customer:c?.customer||'未绑定客户',customerId:c?.customerId||null,strategy:strategy.name,request:JSON.parse(JSON.stringify(demandState)),budgetText:isMultiPlan()?demoBudgetText():'',budgetTotal:isMultiPlan()?demoOrderBudget():null};
  if(isMultiPlan()){
    const sets=demoQualifiedSets(Number(index)).map(si=>demoSetSnapshot(Number(index),si));
    return {...common,mode:'package',sets,rows:sets.flatMap((s,i)=>s.rows.map(r=>({...r,setNumber:i+1}))),total:null,minTotal:Math.min(...sets.map(s=>s.total)),maxTotal:Math.max(...sets.map(s=>s.total))};
  }
  const cards=Number(index)===demoStrategy()?[...planResult.querySelectorAll('.single-set .plan-product')]:[];
  const rows=strategy.ids.map((id,row)=>{const card=cards[row];if(card&&!card.querySelector('.plan-card-check')?.classList.contains('on'))return null;const p=originalDemoData.products.find(p=>p.id===(card?.dataset.demoId||id)),quantity=card?Number(card.dataset.qty):demoRowQuantity(row,p.category),unitPrice=demoQuote(p);return {id:p.id,sku:p.sku,name:p.name,brand:p.brand,quantity,unit:p.unit,category:p.category,unitPrice,listPrice:p.listPrice,subtotal:quantity*unitPrice,warehouse:p.warehouse,stocks:p.stocks};}).filter(Boolean);
  return {...common,mode:'single',rows,total:rows.reduce((s,r)=>s+r.subtotal,0)};
}


function demoFileStem(snapshot){return `${snapshot.customer}-${snapshot.strategy}-${new Date().toISOString().replace(/[-:T.Z]/g,'').slice(0,14)}`.replace(/[\\/:*?"<>|]/g,'-');}
function demoDownload(name,blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function downloadOriginalDemo(format,snapshot=demoExportSnapshot()){
  if(snapshot.budgetTotal!=null&&(snapshot.sets||[snapshot]).some(set=>set.total>snapshot.budgetTotal+0.001)){showToast('当前方案超过预算，请重新生成后导出');return;}
  if(!snapshot.rows.length){showToast('请先选择需要导出的商品');return;}
  try{
    if(format==='ppt'){
      const PptxConstructor=typeof PptxGenJS!=='undefined'?PptxGenJS:pptxgen;
      const file=new PptxConstructor();file.layout='LAYOUT_WIDE';file.author='Selection Lab Demo';file.title=snapshot.customer+'-'+snapshot.strategy;
      const addText=(slide,text,x,y,w,h,size,color='303746',bold=false)=>slide.addText(String(text),{x,y,w,h,fontFace:'Microsoft YaHei',fontSize:size,color,bold,margin:0,breakLine:false});
      const cover=file.addSlide();cover.background={color:'F7F7FC'};
      addText(cover,snapshot.strategy,0.65,0.55,11.9,0.65,32,'6250C9',true);
      addText(cover,snapshot.customer+' · '+(snapshot.mode==='package'?snapshot.request.demoItems.map(i=>i.category+i.qty+demoItemUnit(i.category)).join('＋'):snapshot.request.qty+'双跑鞋'),0.65,1.5,11.7,0.6,24);
      addText(cover,snapshot.sets?'各备选套装报价（不累计）':'演示供货总额',0.65,2.55,6,0.4,16,'737B8A');
      addText(cover,snapshot.sets?'¥'+snapshot.minTotal.toLocaleString('zh-CN')+'～'+snapshot.maxTotal.toLocaleString('zh-CN'):'¥'+snapshot.total.toLocaleString('zh-CN'),0.65,3.05,8,0.9,46,'6250C9',true);
      addText(cover,(snapshot.budgetTotal!=null?(snapshot.request.demoBudget.kind==='set'?'每套预算¥'+snapshot.request.demoBudget.amount+'；':'')+'整单上限¥'+snapshot.budgetTotal+'\n':'')+(snapshot.mode==='package'?snapshot.request.demoItems.map(i=>i.category+'上限：¥'+i.price+'/'+demoItemUnit(i.category)).join('\n'):'供货价上限：¥'+snapshot.request.price+' / 双')+'\n性别：'+snapshot.request.gender+'\n开票：'+(snapshot.request.invoice||'未填'),8.1,2.6,4.3,2.3,14);
      cover.addShape(file.ShapeType.roundRect,{x:0.65,y:5.45,w:11.95,h:1.1,rectRadius:0.1,fill:{color:'EDE9FC'},line:{color:'EDE9FC'}});
      addText(cover,'演示数据，非真实报价。商品、库存、价格与当前页面保持一致。',0.95,5.75,11.1,0.4,14,'75689F');
      let lastSetNumber=0;
      for(const row of snapshot.rows){
        if(snapshot.sets&&row.setNumber!==lastSetNumber){lastSetNumber=row.setNumber;const set=snapshot.sets[lastSetNumber-1],page=file.addSlide();addText(page,snapshot.strategy+' · 套装'+lastSetNumber+' · '+set.name,0.65,0.8,11.8,1,28);addText(page,'本套报价 ¥'+set.total.toLocaleString('zh-CN')+'；独立满足采购数量与预算。',0.65,2.4,11.8,1,23);addText(page,'以下4页为本套商品明细。各套为可切换的备选组合，不将各套金额相加。',0.65,4.5,11.8,1,17);}

        const slide=file.addSlide();slide.background={color:'FFFFFF'};
        addText(slide,row.brand+' · '+row.name,0.65,0.6,11.8,0.9,28,'303746',true);
        addText(slide,'货号 '+row.sku+'  |  '+row.warehouse,0.65,1.7,11.8,0.4,14,'7B8291');
        for(const [i,[label,value]]of [['供货价','¥'+row.unitPrice],['数量',row.quantity+(row.unit||'双')],['小计','¥'+row.subtotal.toLocaleString('zh-CN')]].entries()){
          const x=0.65+i*4.1;slide.addShape(file.ShapeType.roundRect,{x,y:2.65,w:3.8,h:1.7,fill:{color:'F4F2FD'},line:{color:'F4F2FD'}});addText(slide,label,x+0.25,2.9,3.2,0.35,15,'7B8291');addText(slide,value,x+0.25,3.45,3.2,0.55,27,'6250C9',true);
        }
        addText(slide,'尺码库存（演示）',0.65,4.85,11.8,0.4,18,'303746',true);
        addText(slide,Object.entries(row.stocks).map(([size,qty])=>size+'码：'+qty).join('   '),0.65,5.45,11.8,0.9,16,'737B8A');
        addText(slide,'虚构演示资料 · 非真实报价，不代表实际可售库存。',0.65,6.8,11.8,0.3,11,'969BA8');
      }
      const blob=await file.write({outputType:'blob'});demoDownload(demoFileStem(snapshot)+'.pptx',blob);
    }else{
      const xml=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
      const zip=new JSZip(),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
      const sheetEntries=(snapshot.sets||[snapshot]).map((set,setIndex)=>{
      const rows=[['客户',snapshot.customer,'方案',snapshot.strategy+(snapshot.sets?' · 套装'+(setIndex+1)+' '+set.name:'')],['说明','演示补充资料，非真实报价；'+(snapshot.budgetText||'')],[],['商品ID','货号','商品名称','品牌','数量','供货价（元）','小计（元）','仓位','单位']];
      set.rows.forEach(r=>rows.push([r.id,r.sku,r.name,r.brand,r.quantity,r.unitPrice,null,r.warehouse,r.unit||'双']));
      const totalRow=rows.length+1;rows.push(['合计','','','',null,'',null,'']);
      const sheet=rows.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((v,j)=>{
        const cell=String.fromCharCode(65+j)+(i+1),formula=i>=4&&i<totalRow-1&&j===6?'E'+(i+1)+'*F'+(i+1):i===totalRow-1&&j===6?'SUM(G5:G'+(totalRow-1)+')':i===totalRow-1&&j===4?'SUM(E5:E'+(totalRow-1)+')':null;
        const cached=i===totalRow-1?(j===6?set.total:set.rows.reduce((n,r)=>n+r.quantity,0)):set.rows[i-4]?.subtotal;
        return formula?'<c r="'+cell+'" s="2"><f>'+formula+'</f><v>'+cached+'</v></c>':typeof v==='number'?'<c r="'+cell+'" s="2"><v>'+v+'</v></c>':'<c r="'+cell+'" t="inlineStr" s="'+(i===3?'1':'0')+'"><is><t xml:space="preserve">'+xml(v??'')+'</t></is></c>';
      }).join('')+'</row>').join('');
      return {sheet,name:snapshot.sets?'套装'+(setIndex+1):'选品方案'};});
      zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+sheetEntries.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>');
      zip.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
      zip.file('xl/workbook.xml','<?xml version="1.0"?><workbook xmlns="'+ns+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheetEntries.map((e,i)=>'<sheet name="'+e.name+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets><calcPr fullCalcOnLoad="1"/></workbook>');
      zip.file('xl/_rels/workbook.xml.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheetEntries.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'<Relationship Id="rId'+(sheetEntries.length+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
      zip.file('xl/styles.xml','<?xml version="1.0"?><styleSheet xmlns="'+ns+'"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF7160CF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf fontId="0"/><xf fontId="1" fillId="2" applyFill="1"/><xf fontId="0" numFmtId="4" applyNumberFormat="1"/></cellXfs></styleSheet>');
      sheetEntries.forEach((entry,i)=>zip.file('xl/worksheets/sheet'+(i+1)+'.xml','<?xml version="1.0"?><worksheet xmlns="'+ns+'"><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="2" width="24" customWidth="1"/><col min="3" max="3" width="48" customWidth="1"/><col min="4" max="8" width="18" customWidth="1"/></cols><sheetData>'+entry.sheet+'</sheetData></worksheet>'));
      demoDownload(demoFileStem(snapshot)+'.xlsx',await zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    }
    showToast('已导出'+(format==='ppt'?'PPT':'Excel'));
  }catch(error){console.error(error);showToast('导出失败，请重试');}
}

function demoConversation(){return conversations.find(c=>c.id===activeConversationId);}

function demoSets(planIndex=demoStrategy()){return originalDemoData.packagePlans[planIndex]?.sets||[];}

function demoSavedSet(planIndex,setIndex){const c=demoConversation(),set=demoSets(planIndex)[setIndex];return c?.demoPlanState?.[planIndex]?.[set?.id];}

function demoSetProducts(planIndex,setIndex){const set=demoSets(planIndex)[setIndex],saved=demoSavedSet(planIndex,setIndex);return (set?.ids||[]).map((id,row)=>originalDemoData.products.find(p=>p.id===(saved?.rows?.[row]?.id||id)));}

function demoCaptureVisibleSets(){
  if(!isPreparedDemo()||!isMultiPlan())return;
  const list=planResult.querySelector?.('.plan-list');
  if(!list||list.dataset.demoConversationId!==activeConversationId)return;
  const pi=Number(list.dataset.demoPlanIndex),c=demoConversation();if(!c)return;
  c.demoPlanState??={};c.demoPlanState[pi]??={};
  planResult.querySelectorAll('.plan-set-panel').forEach(panel=>{
    const si=Number(panel.dataset.setIndex),set=demoSets(pi)[si];if(!set)return;
    c.demoPlanState[pi][set.id]={rows:[...panel.querySelectorAll('.plan-product')].map(card=>({id:card.dataset.demoId,checked:!!card.querySelector('.plan-card-check')?.classList.contains('on')}))};
  });
}

function demoSetEligible(planIndex,setIndex){
  const products=demoSetProducts(planIndex,setIndex);if(!products.length)return false;
  const brands=(demandState.brand||'').split(/[、,，/]/).filter(b=>b&&b!=='不限');
  if(demoOrderBudget()!=null&&demoGroupCost(planIndex,-1,null,setIndex)>demoOrderBudget()+0.001)return false;
  return products.every((p,row)=>{
    const qty=demoRowQuantity(row,p.category),cap=Number(demoItemFor(p.category)?.price||demandState.price);
    return (!brands.length||brands.includes(p.brand))&&demoQuote(p)<=cap&&p.mainSizes.every((size,i)=>p.stocks[size]>=Math.floor(qty/p.mainSizes.length)+(i<qty%p.mainSizes.length?1:0));
  });
}

function demoQualifiedSets(planIndex=demoStrategy()){return demoSets(planIndex).map((_,i)=>i).filter(i=>demoSetEligible(planIndex,i));}

function demoActiveSet(planIndex=demoStrategy()){const valid=demoQualifiedSets(planIndex),requested=Number(demoConversation()?.demoActiveSetByPlan?.[planIndex]||0);return valid.includes(requested)?requested:(valid[0]??0);}

function selectDemoSet(index){
  if(!isPreparedDemo()||!isMultiPlan()||!demoSetEligible(demoStrategy(),index))return;
  demoCaptureVisibleSets();const c=demoConversation();if(c){c.demoActiveSetByPlan??={};c.demoActiveSetByPlan[demoStrategy()]=index;}
  hydrateDemoPlanData();updatePlanSummary();
}

function demoSetSnapshot(planIndex,setIndex){
  const set=demoSets(planIndex)[setIndex],rows=demoSetProducts(planIndex,setIndex).map((p,row)=>{
    const quantity=demoRowQuantity(row,p.category),unitPrice=demoQuote(p);
    return {id:p.id,sku:p.sku,name:p.name,brand:p.brand,quantity,unit:p.unit,category:p.category,unitPrice,listPrice:p.listPrice,subtotal:quantity*unitPrice,warehouse:p.warehouse,stocks:p.stocks};
  });
  return {id:set.id,name:set.name,strategy:set.name,planIndex,setIndex,rows,total:rows.reduce((s,r)=>s+r.subtotal,0),budgetTotal:demoOrderBudget(),budgetText:demoBudgetText(),request:JSON.parse(JSON.stringify(demandState))};
}
