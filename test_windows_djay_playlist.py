import os,sys,pathlib,traceback
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
# Records written by djay 5.6 for Windows itself (a test playlist "AXIOM Test" made in djay, 2026-10-30)
DJAY_PLAYLIST=bytes.fromhex('545341460300030002000000000000000a0000002b084144434d656469614974656d506c61796c697374000832323742334146432d333531442d364630462d374143352d31343730443231393739444500087575696400084158494f4d205465737400086e616d6500086d656469614974656d506c61796c6973742d726f6f740008706172656e74555549440014000000000000000000000874797065001b00010000000836424634454539372d443643322d383930392d354337412d39354643433633423537334600086974656d55554944730000')
DJAY_ROOT=bytes.fromhex('54534146030003000200000000000000080000002b084144434d656469614974656d506c61796c69737400086d656469614974656d506c61796c6973742d726f6f740008757569640008506c61796c6973747300086e616d6500140000000000000000000000f03f0874797065000c00010000000832323742334146432d333531442d364630462d374143352d31343730443231393739444500086368696c6455554944730000')
DJAY_EMPTY_ROOT=bytes.fromhex('54534146030003000100000000000000060000002b084144434d656469614974656d506c61796c69737400086d656469614974656d506c61796c6973742d726f6f740008757569640008506c61796c6973747300086e616d6500140000000000000000000000f03f08747970650000')
DJAY_ITEM=bytes.fromhex('54534146030003000100000000000000070000002b084144434d656469614974656d506c61796c6973744974656d000836424634454539372d443643322d383930392d354337412d393546434336334235373346000875756964000832323742334146432d333531442d364630462d374143352d3134373044323139373944450008706c61796c697374555549440008353239313131383538643763343935373137373933383264376666663164363600086d656469614974656d555549440000')
PL,ITEM,MEDIA='227B3AFC-351D-6F0F-7AC5-1470D21979DE','6BF4EE97-D6C2-8909-5C7A-95FCC63B573F','529111858d7c49571779382d7fff1d66'
try:
 import uuid
 from windows_bootstrap import build_backend
 import windows_djay
 folder=workspace/'fixtures'/'djay'/uuid.uuid4().hex;folder.mkdir(parents=True)
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 # AXIOM's builders now produce djay for Windows' exact bytes
 assert app._djay_fastcoding_playlist_blob(PL,'AXIOM Test',item_uuids=[ITEM])==DJAY_PLAYLIST
 assert app._djay_fastcoding_playlist_item_blob(ITEM,PL,MEDIA)==DJAY_ITEM
 # Roots (with and without children) pass AXIOM's own lossless root contract
 assert app._djay_root_playlist_contract(DJAY_EMPTY_ROOT)['child_uuids']==[]
 contract=app._djay_root_playlist_contract(DJAY_ROOT);assert contract['child_uuids']==[PL]
 assert dict((k,(kind,v)) for k,kind,v in app._djay_decode_fastcoding_object(DJAY_ROOT)['properties'])['type']==('integer',1)
 assert app._djay_encode_fastcoding_object(app._djay_decode_fastcoding_object(DJAY_ROOT))==DJAY_ROOT
 # Appending the first child to djay's empty root gives djay's own one-child root
 assert app._djay_append_root_playlist_child(app._djay_root_playlist_contract(DJAY_EMPTY_ROOT),PL)==DJAY_ROOT
 two=app._djay_append_root_playlist_child(contract,'11111111-2222-3333-4444-555555555555')
 assert app._djay_root_playlist_contract(two)['child_uuids']==[PL,'11111111-2222-3333-4444-555555555555']
 # A fractional type is not converted, so AXIOM's contract still refuses it
 odd=DJAY_ROOT.replace(bytes.fromhex('000000000000f03f'),bytes.fromhex('000000000000f83f'))  # 1.5
 try: app._djay_root_playlist_contract(odd);raise AssertionError('accepted type 1.5')
 except app._DjayFastCodingDecodeError: pass
 # Repeated strings are aliased the way FastCoding does it, and still decode identically
 dup=windows_djay.encode_windows_playlist({'class_name':'ADCMediaItemPlaylist','header':(3,3,0),'properties':[('uuid','string','name'),('name','string','name'),('type','integer',0)]})
 assert dup.count(b'\x05\x01')==2 and [p[2] for p in app._djay_decode_fastcoding_object(dup)['properties']]==['name','name',0]
 print('PASS: AXIOM playlist records match djay for Windows bytes; root contract, append and refusal of unexpected types')
except BaseException:
 traceback.print_exc();sys.exit(1)
