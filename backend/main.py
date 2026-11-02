import os, re, hmac, random, base64, logging
from pathlib import Path
from uuid import UUID
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from itsdangerous import URLSafeTimedSerializer, BadSignature
import httpx
from openai import AsyncOpenAI

logging.basicConfig(level=logging.INFO)
SUPABASE_URL=os.getenv('SUPABASE_URL','').rstrip('/'); SUPABASE_KEY=os.getenv('SUPABASE_SECRET_KEY','')
OPENAI_KEY=os.getenv('OPENAI_API_KEY',''); INVITE_CODE=os.getenv('INVITE_CODE',''); SESSION_SECRET=os.getenv('SESSION_SECRET','')
TEXT_MODEL=os.getenv('OPENAI_TEXT_MODEL','gpt-4.1-mini'); IMAGE_MODEL=os.getenv('OPENAI_IMAGE_MODEL','gpt-image-2.5-flare'); MAX_IMAGES=int(os.getenv('MAX_IMAGES','5'))
app=FastAPI(title='Starlight Forest',version='2.0')
app.add_middleware(CORSMiddleware,allow_origins=[v.strip().rstrip('/') for v in os.getenv('FRONTEND_ORIGIN','http://localhost:5500').split(',')],allow_methods=['GET','POST'],allow_headers=['Authorization','Content-Type'])

class Login(BaseModel):
    player_code:str=Field(min_length=1,max_length=24)
    invite_code:str=Field(min_length=1,max_length=100)
class QuizSubmission(BaseModel):
    answers:list[int]=Field(min_length=4,max_length=4)
class ScoreSubmission(BaseModel):
    score:int=Field(ge=0,le=100000)
    attempt_id:str=Field(min_length=6,max_length=100)
class ImageGeneratePayload(BaseModel):
    user_note:str=Field(default='',max_length=240)
class GuessStart(BaseModel):restart:bool=False
class GuessChat(BaseModel):session_id:str;message:str=Field(min_length=1,max_length=200)
class GuessAnswer(BaseModel):session_id:str;answer:str=Field(min_length=1,max_length=30)

def signed():
    if len(SESSION_SECRET)<24:raise HTTPException(503,'尚未設定 SESSION_SECRET')
    return URLSafeTimedSerializer(SESSION_SECRET,salt='starlight-mvp')

def headers(extra=None):
    # Modern sb_secret_* key must be sent in apikey, not bearer Authorization.
    return {'apikey':SUPABASE_KEY,'Content-Type':'application/json',**(extra or {})}

async def db(method,table,query='',data=None,extra=None):
    if not SUPABASE_URL or not SUPABASE_KEY:raise HTTPException(503,'資料庫連線環境變數尚未設定')
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            response=await client.request(method,f'{SUPABASE_URL}/rest/v1/{table}{query}',headers=headers(extra),json=data)
    except httpx.RequestError as exc:raise HTTPException(502,'Supabase 連線失敗') from exc
    if response.status_code>=400:
        logging.error('Supabase error %s: %s',response.status_code,response.text[:350])
        raise HTTPException(502,'Supabase 操作失敗，請檢查 Render Logs')
    return response.json() if response.content else []

async def player(auth):
    if not auth or not auth.startswith('Bearer '):raise HTTPException(401,'請先登入')
    try:pid=signed().loads(auth[7:],max_age=604800)
    except BadSignature:raise HTTPException(401,'登入已失效')
    try:UUID(pid)
    except ValueError:raise HTTPException(401,'無效登入憑證')
    users=await db('GET','players',f'?id=eq.{pid}&select=id,player_code')
    if not users:raise HTTPException(401,'找不到玩家')
    return users[0]

async def records(pid):return await db('GET','game_records',f'?player_id=eq.{pid}&select=game_type,completed,score,details,created_at&order=created_at.desc')

async def save_record(pid,kind,score,complete,attempt,details=None):
    rows=await db('GET','game_records',f'?attempt_id=eq.{attempt}&select=id')
    if rows:return
    await db('POST','game_records','',{'player_id':pid,'game_type':kind,'score':score,'completed':complete,'attempt_id':attempt,'details':details or {}},{'Prefer':'resolution=ignore-duplicates,return=minimal'})

@app.get('/health')
async def health():return {'status':'ok','service':'starlight-forest','version':'2.0'}

@app.post('/api/players/login')
async def login(data:Login):
    if not INVITE_CODE:raise HTTPException(503,'尚未設定 INVITE_CODE')
    if not hmac.compare_digest(data.invite_code.encode(),INVITE_CODE.encode()):raise HTTPException(403,'活動邀請碼錯誤')
    code=data.player_code.strip()
    if not re.fullmatch(r'[\w\-]{1,24}',code):raise HTTPException(400,'冒險者名稱包含不支援字元')
    users=await db('GET','players',f'?player_code=eq.{code}&select=id,player_code')
    if not users:
        await db('POST','players','',{'player_code':code},{'Prefer':'resolution=ignore-duplicates,return=minimal'})
        users=await db('GET','players',f'?player_code=eq.{code}&select=id,player_code')
    return {'token':signed().dumps(users[0]['id']),'player_code':code}

@app.get('/api/players/me')
async def me(authorization:str|None=Header(None)):return await player(authorization)

@app.get('/api/progress')
async def progress(authorization:str|None=Header(None)):
    p=await player(authorization);items=await records(p['id']);completed=sorted({r['game_type'] for r in items if r['completed']})
    pics=await db('GET','generated_images',f'?player_id=eq.{p["id"]}&status=eq.completed&select=storage_path')
    image={'url':f'{SUPABASE_URL}/storage/v1/object/public/rewards/{pics[0]["storage_path"]}'} if pics and pics[0]['storage_path'] else None
    return {'player_code':p['player_code'],'completed':completed,'image':image}

@app.post('/api/quiz/submit')
async def quiz_submit(data:QuizSubmission,authorization:str|None=Header(None)):
    p=await player(authorization)
    if any(a<0 or a>=n for a,n in zip(data.answers,[2,6,2,4])):raise HTTPException(400,'無效選項')
    # Upsert choices so returning to a previous question can change the final souvenir prompt.
    attempt='quiz-'+p['id']
    prior=await db('GET','game_records',f'?attempt_id=eq.{attempt}&select=id')
    if prior:
        await db('PATCH','game_records',f'?attempt_id=eq.{attempt}',{'score':4,'completed':True,'details':{'answers':data.answers}},{'Prefer':'return=minimal'})
    else:
        await save_record(p['id'],'quiz',4,True,attempt,{'answers':data.answers})
    return {'completed':True}

@app.post('/api/pinball/submit')
async def pinball_submit(data:ScoreSubmission,authorization:str|None=Header(None)):
    p=await player(authorization)
    # Casual demo: score is client-reported and not anti-cheat protected.
    await save_record(p['id'],'pinball',data.score,data.score>=1000,data.attempt_id)
    return {'completed':data.score>=1000,'score':data.score}

WORDS={'雨傘':['傘'],'腳踏車':['自行車','單車'],'鉛筆':[],'月亮':['月球'],'書包':['背包']}
async def guessing_session(pid,sid):
    try:UUID(sid)
    except ValueError:raise HTTPException(400,'無效遊戲編號')
    rs=await db('GET','guessing_sessions',f'?id=eq.{sid}&player_id=eq.{pid}&select=*')
    if not rs:raise HTTPException(404,'找不到遊戲')
    return rs[0]

@app.post('/api/guessing/start')
async def guess_start(data:GuessStart,authorization:str|None=Header(None)):
    p=await player(authorization)
    if not data.restart:
        prev=await db('GET','guessing_sessions',f'?player_id=eq.{p["id"]}&order=created_at.desc&limit=1&select=id,question_count,completed')
        if prev:return {'session_id':prev[0]['id'],'remaining':max(0,10-prev[0]['question_count']),'completed':prev[0]['completed']}
    result=await db('POST','guessing_sessions','',{'player_id':p['id'],'answer':random.choice(list(WORDS)),'question_count':0,'conversation':[]},{'Prefer':'return=representation'})
    return {'session_id':result[0]['id'],'remaining':10,'completed':False}

@app.post('/api/guessing/chat')
async def guess_chat(data:GuessChat,authorization:str|None=Header(None)):
    p=await player(authorization);s=await guessing_session(p['id'],data.session_id)
    if s['completed'] or s['question_count']>=10:raise HTTPException(400,'遊戲已完成或提問次數已用完')
    if not OPENAI_KEY:raise HTTPException(503,'OpenAI API Key 尚未設定')
    context=s['conversation'] or []
    prompt=f'你是奇幻森林貓頭鷹賢者。玩家正在猜詞。正確詞語是「{s["answer"]}」。請用繁體中文簡短回答提問，提供線索但不要直接講出詞語或完整答案。若被問答案，僅回答提示。'
    try:
        client=AsyncOpenAI(api_key=OPENAI_KEY,timeout=45)
        result=await client.chat.completions.create(model=TEXT_MODEL,messages=[{'role':'system','content':prompt},*context[-12:],{'role':'user','content':data.message}],max_tokens=160)
        reply=(result.choices[0].message.content or '').strip()
    except Exception as exc:
        logging.exception('AI chat failed');raise HTTPException(502,'賢者暫時無法回應') from exc
    if s['answer'] in reply:reply='我差點說溜嘴了！'
    context=[*context,{'role':'user','content':data.message},{'role':'assistant','content':reply}][-20:]
    await db('PATCH','guessing_sessions',f'?id=eq.{s["id"]}',{'question_count':s['question_count']+1,'conversation':context},{'Prefer':'return=minimal'})
    return {'reply':reply,'remaining':9-s['question_count']}

@app.post('/api/guessing/answer')
async def guess_answer(data:GuessAnswer,authorization:str|None=Header(None)):
    p=await player(authorization);s=await guessing_session(p['id'],data.session_id)
    def normal(t):return re.sub(r'\W+','',t.casefold())
    correct=normal(data.answer) in {normal(w) for w in [s['answer'],*WORDS.get(s['answer'],[])]}
    if correct and not s['completed']:
        await db('PATCH','guessing_sessions',f'?id=eq.{s["id"]}',{'completed':True},{'Prefer':'return=minimal'})
        await save_record(p['id'],'guessing',10-s['question_count'],True,'guess-'+s['id'])
    return {'correct':correct,'completed':correct or s['completed']}

CLOTHES=['wearing a stylish formal business academy suit with elegant gold trim','wearing an observant social science scholar outfit with a notebook','wearing an expressive media and communications academy outfit with creative accessories','wearing soft literary academy clothing with scarf and classic books','wearing imaginative casual adventurer clothes','wearing a magical academy robe decorated with stars']
SYMBOLS=['A large distant dragon silhouette in the sky','A clearly recognizable volleyball beside the character','A faint translucent misty spirit hovering quietly in the background','Mystical decorative floating letters and runic text-like symbols orbiting the character']

def image_prompt(answers,user_note=''):
    academy, pudding, quote=answers[1],answers[2],answers[3]
    parts=['Use the provided character reference as the design base. Keep the original yellow body, pale belly, green eyes, and overall silhouette. Make the character noticeably cuter while preserving its core identity and recognizable features. Give it softer and rounder body proportions, slightly larger expressive eyes, a gentler and more lovable facial expression, and a warm playful charm. Present the character in a more adorable and endearing way. The character should be shown from the front, facing the viewer directly, with the head clearly oriented forward.', 'Create a single beautiful vertical fantasy forest adventure souvenir illustration with glowing starlight crystal, restored forest shrine, magical warm evening light. Full body character, appealing storybook composition, professional 3D cartoon render.','Clothing: '+CLOTHES[academy]+'.','Narrative magical element: '+SYMBOLS[quote]+'.']
    if pudding==1:parts.append('Add a tasteful amount of wealth symbolism: several gold coins, gems and a subtle ornate golden accessory.')
    parts.append('Do not turn this creature into a human, avoid adding other main characters. Keep details coherent and visually legible. Do not include user name or personal information.')
    if user_note.strip():
        parts.append('Player custom note (higher priority than default clothing, decorative elements and atmosphere; preserve the reference creature identity and single souvenir task):\n'+user_note.strip())
    return '\n'.join(parts)

@app.post('/api/images/generate')
async def generate_image(data:ImageGeneratePayload=ImageGeneratePayload(),authorization:str|None=Header(None)):
    p=await player(authorization);pid=p['id'];items=await records(pid)
    if not {'quiz','guessing','pinball'}.issubset({r['game_type'] for r in items if r['completed']}):raise HTTPException(403,'需要先完成三關')
    existing=await db('GET','generated_images',f'?player_id=eq.{pid}&select=*')
    if existing:
        record=existing[0]
        if record['status']=='completed' and record.get('storage_path'):
            return {'url':f'{SUPABASE_URL}/storage/v1/object/public/rewards/{record["storage_path"]}','cached':True}
        raise HTTPException(409,'已有生圖任務，請勿重複發送；如先前失敗，請找管理員確認')
    all_images=await db('GET','generated_images','?select=id')
    if len(all_images)>=MAX_IMAGES:raise HTTPException(429,'已達全站測試生圖上限')
    quiz_entries=[r for r in items if r['game_type']=='quiz' and r['completed']]
    choices=quiz_entries[0].get('details',{}).get('answers') if quiz_entries else None
    if not isinstance(choices,list) or len(choices)!=4 or any(not isinstance(x,int) for x in choices):raise HTTPException(400,'找不到有效心理測驗答案')
    if not OPENAI_KEY:raise HTTPException(503,'未設定 OpenAI API Key')
    ref=Path(__file__).parent/'assets'/'character-reference.png'
    if not ref.is_file():raise HTTPException(503,'找不到角色參考圖片')
    await db('POST','generated_images','',{'player_id':pid,'status':'pending'},{'Prefer':'resolution=ignore-duplicates,return=minimal'})
    try:
        client=AsyncOpenAI(api_key=OPENAI_KEY,timeout=145)
        with ref.open('rb') as file:
            result=await client.images.edit(model=IMAGE_MODEL,image=file,prompt=image_prompt(choices,data.user_note),size='1024x1536',quality='low',n=1)
        image_bytes=base64.b64decode(result.data[0].b64_json)
        object_path=f'{pid}/souvenir.png'
        async with httpx.AsyncClient(timeout=35) as http:
            response=await http.post(f'{SUPABASE_URL}/storage/v1/object/rewards/{object_path}',headers={'apikey':SUPABASE_KEY,'Content-Type':'image/png','x-upsert':'true'},content=image_bytes)
        if response.status_code>=400:raise RuntimeError('Storage upload failed: '+str(response.status_code))
        await db('PATCH','generated_images',f'?player_id=eq.{pid}',{'status':'completed','storage_path':object_path},{'Prefer':'return=minimal'})
        return {'url':f'{SUPABASE_URL}/storage/v1/object/public/rewards/{object_path}','cached':False}
    except Exception as exc:
        logging.exception('Image request failed')
        await db('PATCH','generated_images',f'?player_id=eq.{pid}',{'status':'failed'},{'Prefer':'return=minimal'})
        raise HTTPException(502,'生圖失敗；請向管理員再處理重試') from exc
