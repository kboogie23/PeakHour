import os,sys,pathlib,traceback
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
# A root playlist record written by djay 5.6 for Windows (all numbers are doubles)
DJAY_ROOT=bytes.fromhex('54534146030003000200000000000000080000002b084144434d656469614974656d506c61796c69737400086d656469614974656d506c61796c6973742d726f6f740008757569640008506c61796c6973747300086e616d6500140000000000000000000000f03f0874797065000c00010000000832323742334146432d333531442d364630462d374143352d31343730443231393739444500086368696c6455554944730000')
# The ADCBeatGridEdits object djay 5.6 for Windows wrote when the downbeat was moved in djay
# (2026-10-30); in djay's record it started at an offset of 6 mod 8.
DJAY_EDITS=bytes.fromhex('2b0841444342656174477269644564697473001400000000000000000020c1cce23f086669727374446f776e62656174506f736974696f6e00140000000000000000086e724f66426561745368696674000a0000000008646f776e626561744d61726b657273001400000000000000000000086669727374477269645365676d656e7454656d706f4578706f6e656e7400140000000000000000086c617374477269645365676d656e7454656d706f4578706f6e656e740014000000000000000000086672616374696f6e616c4265617453686966740000')
def place_edits(obj,mod=6):
 """A decodable user-data record holding obj at an offset of mod (mod 8), as djay stored it."""
 head=b'TSAF\x03\x00\x03\x00'+struct.pack('<III',2,0,10)+b'\x2b\x08ADCMediaItemUserData\x00'
 filler=next(n for n in range(1,9) if (len(head)+1+n+1+3)%8==mod)
 return head+b'\x08'+b'x'*filler+b'\x00\x08f\x00'+obj+b'\x08beatGridEdits\x00\x00'
try:
 import uuid,struct,plistlib
 sys.path.insert(0,str(workspace))
 from djay_fixture import blob,title_id
 from windows_bootstrap import build_backend
 import windows_djay
 folder=workspace/'fixtures'/'djay'/uuid.uuid4().hex;folder.mkdir(parents=True)
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 import djay_beatgrid_publisher as grids, studio_daw.djay_analysis as analysis
 from utils.dj_track_colors import decode_djay_record
 decode=decode_djay_record
 # Metadata: djay for Windows' integer grid flags read as booleans, written back as integers
 deep={'version':8,'hasStraightSegment':1,'straightGrid':1,'forcedStraightGrid':0,'firstDownBeatIndex':0,'bpm':105.5}
 raw=plistlib.dumps({'deepBeatTrackerInfo':deep},fmt=plistlib.FMT_BINARY)
 seen=grids.plistlib.loads(raw)['deepBeatTrackerInfo']
 assert (seen['hasStraightSegment'],seen['straightGrid'],seen['forcedStraightGrid'])==(True,True,False) and seen['firstDownBeatIndex']==0 and type(seen['firstDownBeatIndex']) is int
 back=plistlib.loads(grids.plistlib.dumps({'deepBeatTrackerInfo':dict(seen,forcedStraightGrid=True)},fmt=plistlib.FMT_BINARY))['deepBeatTrackerInfo']
 assert back['forcedStraightGrid']==1 and type(back['forcedStraightGrid']) is int and type(back['straightGrid']) is int
 assert analysis.plistlib is windows_djay.PLISTLIB_PROXY and grids.plistlib.loads(plistlib.dumps({'x':2}))=={'x':2}
 # Exact-path lookup: djay's file:///C:%5C... URLs resolve to the drive path
 assert analysis.unquote('/C:%5CMusic%5CCaf%C3%A9%20One.mp3')=='C:\\Music\\Caf\u00e9 One.mp3' and analysis.unquote('/a%20b')=='/a b'
 assert app.DJAY_METADATA_ROOT.endswith('Metadata')
 # Number transcoder: djay's own records are unchanged byte for byte
 user=blob(('ADCMediaItemUserData',{'uuid':'w1','titleIDs':[title_id('w1','Song')],'playCount':3.0,'cuePoints':[('ADCCuePoint',{'time':0.5,'endTime':-1.0,'number':1.0})]}))
 assert windows_djay.transcode_numbers(DJAY_ROOT)==DJAY_ROOT and windows_djay.transcode_numbers(user)==user
 # Compact numbers (as AXIOM writes them) become doubles with the same values; aliases survive
 compact=bytearray(b'TSAF\x03\x00\x03\x00'+struct.pack('<III',1,0,6))
 def num(tag,fmt,value):
  compact.append(tag);size=struct.calcsize(fmt);compact.extend(bytes((size-len(compact)%size)%size));compact.extend(struct.pack('<'+fmt,value))
 compact+=b'\x2b\x08ADCBeatGridEdits\x00'
 num(0x13,'f',0.0188);compact+=b'\x08firstDownbeatPosition\x00'+b'\x2e\x08nrOfBeatShift\x00'+b'\x0d\x08isStraightGrid\x00'
 num(0x0f,'b',5);compact+=b'\x08small\x00'+b'\x05\x02'+b'\x05\x02'+b'\x00'  # string alias to "firstDownbeatPosition"
 compact=bytes(compact);tags={}
 doubles=windows_djay.transcode_numbers(compact,tags)
 assert decode(doubles)==decode(compact),(decode(doubles),decode(compact))
 after={};windows_djay.transcode_numbers(doubles,after)
 assert {13,19,46,15}<=set(tags) and not ({13,14,15,16,17,18,19,45,46}&set(after)),(tags,after)
 assert decode(doubles)['firstDownbeatPosition']==struct.unpack('<f',struct.pack('<f',0.0188))[0]
 for bad in (b'XXXX'+DJAY_ROOT[4:],DJAY_ROOT+b'\x00',DJAY_ROOT[:20]+b'\x21\x08x\x00\x00',DJAY_ROOT[:-1]):
  try: windows_djay.transcode_numbers(bad);raise AssertionError('accepted bad record')
  except (ValueError,IndexError,struct.error): pass
 # The grid publisher's record writers now emit doubles only and keep the values
 assert all(getattr(grids,n).__name__=='write_record' for n in windows_djay.GRID_RECORD_WRITERS)
 analyzed=blob(('ADCMediaItemAnalyzedData',{'uuid':'w1','titleIDs':[title_id('w1','Song')],'bpm':100.0,'isStraightGrid':1.0}))
 out=grids._replace_djay_root_numeric_properties(analyzed,'ADCMediaItemAnalyzedData',{'bpm':105.5})
 h={};windows_djay.transcode_numbers(out,h)
 assert decode(out)['bpm']==105.5 and decode(out)['isStraightGrid']==1.0 and not ({13,14,15,16,17,18,19,45,46}&set(h)),h
 edited=grids._replace_djay_manual_grid_edit(user,0.0188,clean_bpm=105.5,analyzed_bpm=105.5)
 h={};windows_djay.transcode_numbers(edited,h);r=decode(edited)
 assert not ({13,14,15,16,17,18,19,45,46}&set(h)) and r['beatGridEdits']['_class']=='ADCBeatGridEdits' and r['playCount']==3.0 and r['cuePoints']==decode(user)['cuePoints'],r
 # The same edit djay made (downbeat moved to 0.587494432926178 s), written by AXIOM, is djay's object
 # field for field: identical once placed at djay's alignment, and identical decoded values and types
 djay_record=place_edits(DJAY_EDITS)
 assert djay_record.index(DJAY_EDITS)%8==6 and windows_djay.transcode_numbers(djay_record)==djay_record
 djay_edits=decode(djay_record)['beatGridEdits']
 axiom=grids._replace_djay_manual_grid_edit(user,djay_edits['firstDownbeatPosition'])
 axiom_edits=decode(axiom)['beatGridEdits']
 assert axiom_edits==djay_edits and all(type(axiom_edits[k]) is type(djay_edits[k]) for k in djay_edits),(axiom_edits,djay_edits)
 i=axiom.index(b'\x2b\x08ADCBeatGridEdits\x00');j=axiom.index(b'\x08beatGridEdits\x00',i)
 # Same token sequence as djay's: only alignment padding (which depends on the object's offset) may differ
 strip=lambda b:b.replace(b'\x00',b'')
 assert strip(axiom[i:j])==strip(DJAY_EDITS) and abs(len(axiom[i:j])-len(DJAY_EDITS))<8
 assert windows_djay.transcode_numbers(place_edits(axiom[i:j],i%8))==place_edits(axiom[i:j],i%8)
 print('PASS: djay for Windows grid flags, exact-path lookup, double-only record writes, transcoder byte-exact on djay records')
except BaseException:
 traceback.print_exc();sys.exit(1)
