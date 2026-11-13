import os,sys,pathlib,traceback,struct,zlib,base64
s=(pathlib.Path(__file__).resolve().parent/'probe_startup.py').read_text(encoding='utf-8-sig')
exec(s[:s.index('try:\n import app')])
# The mediaItemUserData record djay 5.6 for Windows wrote (2026-11-13) for one track with a single default hot cue:
# cue 1 at 2.1907708644866943 s (a float32 value stored as a double), no name, no colour. Key faf9cfff8bf96af90db5bdb5d54960c0.
REAL_USER_DATA=zlib.decompress(base64.b64decode(
'eNplWGVQFOwaXdAFJAQVCelUQlxYGgHp7hKWWmCBJZbYpVNaSrpTBASkkWbpTkGaj46lpKXheu937507c5+ZZ+adM+ec5/x5/xxtLQnZB4AHAF'
'zA30P6ZznwJKSlVGAWcKgCCmavg4Q5S0NRUACeJdRSyNzS0lLQzFKI/88bZGHGZ/ZnLfh4hfhB5iAAnosL3AJAgPV/HtpwlB1MQRoAxAJi4zEx'
'0Os7uNBrOyDgVtYo+leyMCjKxRmOsKLX5KJXgtnZebAB8FD/VADwVB1QDs5wBxckvSSXApccAA/qjIIjUf+KmVOR7vIOz8LFGYqCOyAA/9YoSC'
'MB+ADAfzNIucDUHeCIvyX/muWqEKx3f8j2sP9ih614MISF9v9Cf+PieAgXezOY8x93838bIf/2lXCxgDtI2MGtEPYwBEr2T3yYs6PzPw89hz8F'
'ANwzgO249Em2VADTarG8SKZHMGYFmR74xeJ1ZRxjgnacooF82mp5tLZkWGQMqZxkXE3UOZqNXWFDni02QUOeMU7j3oU7OfEuh/8Cr5iG7vDoeD'
'7444TbsrwPGauRiWz4OQH3N+N3OHUmuRWWwCmbR6CjMDqx1lfDAmeRcd4+nN5PXveURglViDuKt7oOCoUhSFd4s1S3ZEjTV1xTeW40SkLffvU/'
'fT4L0plNGT5MejOUtt8uPpKp9iwqqtLsZ9r6qB4DX3BsxwMOHivby63OzoVr++0wTLvMEHfQ+qKIo915SVwN3U5MOnh0T3JGMmw4+wF7SKed7G'
'dawW8/LLSim6QacvnTd5O7SrNasDPGmy8IxKtAHAwk3ELYdLrZTOeYg3qtxUDmXzZxqDIgGp0f6bqNc5OyD0hrUlv3zdYJjHJqbXdPx4o/HGZx'
'cYG8d58kPV7kfJjtKFAAmiZAU1x3pPjxGypVh1qhbZd/XdF6X1zw+8ky0Q0Ki09Iq3fX6bjyVooSqw3tMh2V1/34aPQSNn9J8RYSS+WDeSQiZo'
'2s29GTmi+8z0EN4sTMJjxiLyq180Y3jYnxpFF2PuHfftQ+O/q2qyBFYmKeU5UCEcRWQkUikJ/bz66AH8ff+Z5kmWrkeWjagVnBOv7pLzF/XSzd'
'mzaYGhRRqI5x6qGN0w2SLJlWgmp+wkUJHsY82cROtkKHiKATQe/ZhtfRtx9id9HN4X0O1uXqkvHD2R4tDo0X+YiwhBHhH0HNJcxVUJqPXuXvrg'
'm8FE6/l1XMyAet6wi3C/gQ6ZWc4rpiGju3rPUPjcwGZqV9ACfcfIdOqMDqfewKfOEOzjeuzl3TkqM/9nPmxvp0HMo797YvKV6sK1elP3QfrMJr'
'bREZgXzZjduToOWDdB2Otne7IzOAj+vO/eXrKJknPTtaeOD1r5B0nyUTuMfdCKb/umhiZiiJUcHo+X+llKzn36VQ8r4mz9qda9P+0tW2os47ob'
'4gASRQVuLrPFEvWwrx+WljyqercgH2UivKKjMqmpsQNvBwJeK4zTUVK1VrY5eerkrVYuwzk6GbPWhWM1zTFF4xkJYT+yrp1OP5u3GnruE454nt'
'4/QBQpo6rRotfh2v9xNhA75z17XZEF7RD/0SVGBFWkt09ersptPgOxnmkIfl0Rp7Y4LFav05Arv8cZ2pLo5wDdymxqSZaXu62ZRZriQtDv+wAS'
'QzzEaVtjGVVH1Rub1k/Mg1rgQkqhalwnECBeoJJn11BKr42hWeLEK2NTQpRX1NlGmT2nOc2AEIGKZzgkKj1sbtmUimd3Jiakr7AUSjpueUnEa8'
'JZq3t85Jm7Tje0ntcrkDEybXj3TqdWNXc7pvhSTYln96A9+QipbhunHL4vAXG9v8nUquX9aENlDL09GHg7WcjyGT0xblBQm/nicy9cSq8sEG18'
'rYCFxfbNBf380F8ukogOtKfGOYxIiOz5dyFSIK1Wu/gol0G9XNEWCXQvE8I03fBGYoPlTNTJG26Kxj4kr+t/IdCyTdZGCkCFKhIPSJYY41dbZ7'
'XWJXqUvl/mFux1XeQoJH1nsRTNDd00RpJXLNjmmGxqllZVYiKe+zFr+jD5FiX22kq7alKL/1FyTL8E6D93OyQQyXtI3iR0HyLYTNv3MJqzMdNC'
'/evnlqaBRgJnN1U+g/OnPnRss15/gMUe88xMyNtWpy18WppqK6ofSSlv21GQHzBLR0nB7uXe5/iFHjdcol43UAbxCxVMuHXgeeRKkG3m8+GnJs'
'5kr5XTIWOeZjUQ9JS82AYNWdIZfLtEl+uWUMPD+dAceT/45pgFBFc4jEtfeZv9X5MXxtqCGhgQ45JaOMzbqXM0Yg6e9VwdQDNOZ9i624JXvrK2'
'NibphswajBT497Aw3MQXelfM1KbEEGURQ3ej+wPf32PtzRS9UydtEYpIlyF6pGZqtrBW7dUQaBKB+MU4MKjLb88qZ+Jrr/XhQcr4huw5Qxr/NC'
'QK87sFfjp+MuvkMMnX/pOPoKM+89hQfEnGU4tgJ7lS9wKL4a4v9QsBrrysOx0azjUTV85NygbHg26G+3+2b1ks7Ie8wRoGhfnBtz3Nrnkfb8mb'
'goHmWpbazD7bvGqcDDMgiOpJiJZQg5lfVgi/Yp1eVApEMKT1FC8pdxlgeQXXHzzXED38x+uxReoeB4X0zPerlhd6/oYGq+ndhQ2EMSu+v2T1Ds'
'iHtR3LubRQC0kGxlf7t/bL+GMoL4k+TerblF9nq4DzSO2cmMTvyqhOjHUCynGbOEqisO9Qvr7khdnb0C2s1Tafwpca2gEy4r9ZocfG9sKu5xSA'
'LcMAUy/jmrT1fvDutSkDLMtr49U90hpAt8VSFwyp7BaV/IFHqw8qTF4z3GkOgZMXA8yQl4cRRKgU6PwS4JYAftuhK3FoU/QziVWDCa2HLn6CYN'
'Fw1w4tuzBSK1stubd3GHF2lIoc+uI+uzHHLtthXotPGGzAamBJRkycje1YRRAzlTH/xKlunrrIiLaDNVPCeAXe0WrJI3sIzt08vt0gRUVv983G'
'kly60mJEBKoGS1mldg2Kuld6FLF3zP1f+h4NPOghyLWkHhEnDLzmhmuCz0cOeNVXEsfldltw7nSAtQRiA6yaZk65l4Tdi+CgU4+6ooLhVtXTg9'
'SJxos1VWeM+lx9MwQ7e5wzK5pxTIGbHUoe4lneTKYTH2MZnPAj6m2J1MpXA6S3Iy7mctBv1efrk+nsppxIFLw9tRJOVUr13TEk27qNERk+DZp8'
'Fm1g+sHGo6oYxwu6Nb2kzqOGdpLVwbjk6YfKLCNH5E2orG1huJMO3FQelrqLwqgfeDk4m9u8JbJCmSRTOnPCbH+yf9NI5zlWosLB8bpxc/6pX1'
'mfFkkUvyrvTvxinMy+qkNhAzlT23JNLw6fFq9DVOc1jAU/44CZ5OFR1yafAPtpGvKkycXMB8WPqS4PYpbjWvb3+C4ZfrnENFmXJPmKbIwnp6p/'
'ZfflXd+0j9zvFC5QJXQlojtzwV/HL5bgfcYULOnP3EVAvqHeWoCaPDqmNWzeYnQy4vmM2MLbBp8Q6g+MK+nIZ83YbFigFE+3ywRFwyMHhWX9m+'
'V1x51PaF/l4Jq2+LRJF84/PJRJ8CrnYSe7S2yvMB54rJUor6VTXQ5+qsxNKf5j2SWj0RSzBjyNuVL/etyqoTDy3fxK2dENUGfovnc2vdf93wcH'
'ctMO0cZaeL7eF7lnPBq6aIVOxkvn1tCO/iK6DY7NgsUKyqvpepRmIhOJUZcK92vI58a4lljWPa5svkhDqjpJjdUR9Oq8DWo9ne6A7VNiV3m5Os'
'ZOexdyw4I1N/mdV2fxi7VArd3ZnoqF+LaKt9hY3dugW9pKLF9/v1kkkk6/qmkPZx2dgKq1tYzvQENqGSzmpeMQcltUcgebQh68aeEAj9nYSLrL'
'GiKE38Um3w93GsAKFppjJhwl/ZfazEnlC7XgsxHW1S8MTN4Vh808XqItFQ1LxM3Hzdahunwqu/NDshFLzmMx/EKah9CTa5EEGjCKoG/o35+szy'
'jQXiKJ5tILlpvjk1BORBRH0pmj488DHEmIo2mS8l4C5O1H2NDlZPyp+lPU96dLxpPjOZq2TgNhIbKsURcpqxOY96XXljL/I+zbCHSLafRDMH91'
'iPeA0r0KDvRUZ76+OUXtLkzJD02OKhWTNyh7Hlx9xUfm1hM9IFUM5l2H2yFEGGnIJ35tNprXVinNnfqD1HHiHM6YfvXlx98s0d02DjiZ8UetYV'
'RYGrcnHK0wvhNTUCpqdzoepia6/CRpn4SzAkMy7w6o+q5am6e5KvKup71Uws2vftStnDF3aDWTttMCc+j32dTrpWL4dnkFf054yeBGzKIp3EVP'
'uhzR8p3bcbn74s+mWU4F5MmGas3b7+08ZX5udDNNscAD+zoGIy160h63ODur0lUAdRPkt2H7EM1ZLBLrKtKWkjrPlSanozzz6O5gkkCwXGf2HE'
'VdqRdfpdSHrjrByg3CkVpJYVXGUUunBknc2o29R1tNTKyh06J1FAe/08gMnkqPvD6tBxJ/11OnjZIdwHuzQERKiFHzQtMr2sUag7dyuUkRT60T'
'Q3XzhowUM53u356rSOMIWbeMuFqis7eeNwSl2sTwTDbVEHhg1sarevKzjp9oidf3jdzigJlAocnVnnEF+5LLfN8WD2bxUHFa5vItS89/8iAKuo'
'xtjcuY6LvvXfbuIfD9Ayzqjfkbxx7U38NI7HT/7QsqLREOxL6qlkRd6fXDzimq90YjiDNDblSvfMOrOThz4lC2T+bSGyz7WgKDzQn+BVm1S2Kb'
'666/to5gF60PBoSROpkM9TO4ykhruUTFwfSOXzyCnBvdIY6HId09ia5c03e+dna1OpTxLrnk4RJcVefJmume0ILb5TKqx9n8Vo97Z+oaFV/6eP'
'19TrVNMyR45snbNgMNu8TTPq54eOB9TbxnO4xzQ1q27FV5JXhcYF3l/j9bk0ze+K+UlEz9ij+YW0Lgfz8xlvHYqYF4j1Gt3ALrUZHn5UpiO0DZ'
'yvt6iV0Pn4boQeL+73mDLduTNNfRn3fDjDP8uy8rZzk7e23PYleK++/7Ih+hum/ERYkAq9PULMs5Tt/yabNSYukBhIDPzBpifU6FJDbW5EKO8p'
'jVVYfsAMv6cT3PKivF7CjjbaB1kwJefPThAM6g/SmG/WdUTRbEmbCmpHfnO9zeHIeOYjL59/xwx7YUyqDHTbxzRLP4gH7YGoSpWs8EW63gfYks'
'03YMIuLyioWCP3A26XHvO0+AvWU061n7l5rz9NH3aPID5QYLllvjupDPh8N/iSzixhp0zStemcwfvTqsNruoC1DS67VT2gbh7RN4sVntoJwUQR'
'SpGAg1ZU0kLSurpMR/i026wU7uTjWMwvvKeu9q+FqrVrmJ0DAQc21kfm4UKOm1V41fGlARa7LRl79jS8N+isqOQ9rEmR1JnjcWxOajv471FZ1t'
'yJvkvfnxuSUDpjrcyQfk+nCo0xAibbl6bXhyqaZ3yrtTYukpuUsFr7phcmRaMrq2qW6k0F5EOqkTxnHt0XdVEvBCbf4r2Zj+pUCUcelRzQywr/'
'NIPpcPYrx62ZMXrcFYZg76BNRgSiWNpKG3AOkeXEGF7m1QsPSMPOBe1XpCAg1TIuUsXmw4R9/AyrigzI4NWyVD2+fMxsZG8iXftOJ0SBc4BMqR'
'qi0aY3trfKhkJB6P02IfhLmgy9xEB9sgPESZtQa5ZUcuv7jz1JoguD5ff+BfdMiANnD8vsg0fJOGnLIhgJWV+Q9jllp4iJAGtaE+EoW/pTkc8h'
'ih7R3iGg3m8Kw9EzYlZp5OYARdh0fXErUt5j3PDGTe1Fs+08kdbUvIRFJGPB44dO5GKD+ARNQMMtHRr+71VkHVkG3Ep2WLcv2FYcHR/XGCUtUw'
'/4mUtVsmU5zgQLvdaRRw9gtpjVWNtVSVbHI7efcLO8tMQ9qSzk/3wW6ieYistoWG7+ckIdtaYq92b9+nU+Aw8/7dyqZI7PieVK9w5MHUaP49Ac'
'r/8ug5grloIxdWL0aLxfHaHqw+hLIiQRfvImZk+AQFlFOeRW3yWFBSM52D/srRQgd3SoTkH47ajnGdLycxpMo99/xY3/Pk6UUIzav0KA57BhW1'
'SrnkdjZpa0q4FFzD+Mj/8G0yMtmOSdoEtbk2Ov8p2Ciuyd8FjUuQ9f5f1H8pEh/aiAbHL3tRW8O6023BEjK5Oj3oMWjAj4WVBIWRv5BZg7VcX7'
'ottqSAFK/exGr8NCTthUqobB0+M31Kyc4EqDwSS1MkjXhovBCULkzaTAy7EGav2r3J/V4gvB/APR5YMrNnVtrUH9vSsCveCMlVADD8zkkX/wcn'
'9wIY0/1ndayx+pvbpzYj3ZiA3DIjcGLRfNDVzqFhCILynp4DIcfdTovaRmciPcHKKa5PcO8Z3/LZ+44uKOGMVBA+UE/jG0S4Hqqeb6RbQKR8WU'
'POBHITP9VHf9+jcX4eSDkz9fYTSojK8wdbiGr3mm1yllupEgr2Xk3c8HJt6m9RTwPfbZ80+d1Wo27uRW9m9zvqn6JX7JUxqjtcaId/slJT6JLn'
'XuBWhaDfK7Bd5iIWPS9wZcPnp1DBLvKw9X4cyVyb9LuuAFNZYGxo94St6NyjabVqZgc3GxJn+/fdWqGvtFaxEv6gypwFiDG1HNctEUtUGyjiTa'
'IGU9GXS+ya1gSbtfymAvqLoADPkd4Qwkv6941hu8kOevW1thy2PdKoqt6Zt4k90SHPOcZEDIw55lAukk2CO0lt1hmYY+orfESAeck0PSZuuoDR'
'gjDkuzmdDq1VfiltCCK8C/ii97GBIFtXdUsIAhUHBL+L8bu//psvBcYc7I/9Rk/8f+D/NQHM/RDuoh5eCCQAGwgcCngH8AvkvCDw=='))
try:
 import uuid
 from windows_bootstrap import build_backend
 import windows_djay_cues as cues
 import utils.djay_cue_codec as codec
 folder=workspace/'fixtures'/'djay'/uuid.uuid4().hex;folder.mkdir(parents=True)
 app=build_backend(recording_settings=folder/'settings.json',recording_directory=folder)
 real=REAL_USER_DATA
 assert len(real)==5152 and real[:8]==b'TSAF\x03\x00\x03\x00'
 def keys_of(data): return [[k.value().decode() for _v,k in cue[2]] for cue in cues._cue_objects(cues._parse(data))]
 assert keys_of(real)==[['time','endTime','number']]  # djay's default cue: no comment, no colour
 assert cues.djay_default_cues(real)==real and cues.djay_property_order(real)==real  # the real record is already in this layout
 # the same record as it was before the cue was set: no cue object, the later object reference moved up one
 root=cues._parse(real)
 for i,(v,k) in enumerate(root[2]):
  if k.value()==b'cuePoints': v[2][:]=[]
  if k.value()==b'timestampIdentifier' and isinstance(v,tuple) and v[0]=='objref': root[2][i]=(('objref',v[1],v[2],v[3]-1),k)
 before=bytearray(cues._emit(real,root));objects,extra,strings=struct.unpack_from('<III',before,8);struct.pack_into('<III',before,8,objects-1,extra,strings-4)
 before=bytes(before);assert codec.read_cues(before)==[] and len(before)<len(real)
 # PEAK HOUR writes djay's own bytes for a default cue: the cue has no name and no colour (or the default one)
 default={'index':0,'time_ms':2191,'seconds':2.1907708644866943,'label':'','color':cues.DEFAULT_COLOR}
 written=cues.encode_cues(before,[default])
 assert written==real,(len(written),len(real))
 assert cues.encode_cues(before,[dict(default,color='#a3ff00')])==real  # same colour, other case
 # the time is rounded to float32 like djay's, even when it comes from whole milliseconds
 assert cues._f32(2.191)!=2.191 and codec.read_cues(real)==[{'index':0,'time_ms':2191,'label':'','color':cues.DEFAULT_COLOR}]
 plain=cues.encode_cues(before,[{'index':0,'time_ms':2191,'label':'','color':cues.DEFAULT_COLOR}])
 times=[v[3] for cue in cues._cue_objects(cues._parse(plain)) for v,k in cue[2] if k.value()==b'time']
 assert times==[cues._f32(2.191)]==[struct.unpack('<f',struct.pack('<f',2.191))[0]]
 # number is a double, endTime -1.0, and the list keeps tag 10
 for cue in cues._cue_objects(cues._parse(plain)):
  values={k.value():v for v,k in cue[2]}
  assert values[b'number']==('num',20,'d',1.0) and values[b'endTime']==('num',20,'d',-1.0)
 assert b'\x0a\x00\x00\x01\x00\x00\x00+' in plain  # array tag 0x0a, one item, then the object
 # a named or coloured cue keeps comment and color, in djay's order
 named=cues.encode_cues(before,[{'index':0,'time_ms':2191,'label':'Drop','color':cues.DEFAULT_COLOR}])
 red=cues.encode_cues(before,[{'index':0,'time_ms':2191,'label':'','color':'#CC0000'}])
 assert keys_of(named)==keys_of(red)==[['time','endTime','comment','number','color']]
 assert [(c['label'],c['color']) for c in codec.read_cues(named)]==[('Drop',cues.DEFAULT_COLOR)]
 assert [(c['label'],c['color']) for c in codec.read_cues(red)]==[('','#CC0000')]
 # a mix: the default cue loses its two properties, the coloured one keeps them; every string reference stays valid
 mixed=cues.encode_cues(before,[default,{'index':2,'time_ms':30000,'label':'Chorus','color':'#0099FF'}])
 assert keys_of(mixed)==[['time','endTime','number'],['time','endTime','comment','number','color']]
 assert [(c['index'],c['label'],c['color']) for c in codec.read_cues(mixed)]==[(0,'',cues.DEFAULT_COLOR),(2,'Chorus','#0099FF')]
 assert cues.djay_default_cues(mixed)==mixed and cues.djay_property_order(mixed)==mixed
 assert struct.unpack_from('<I',mixed,16)[0]==sum(1 for s in cues._strings(cues._parse(mixed)) if s.ref is None)
 print('PASS: a default djay cue is written as djay writes it (time, endTime, number; float32 time) and matches the real record byte for byte; named and coloured cues keep all five properties')
 import shutil;shutil.rmtree(folder,ignore_errors=True)
except BaseException:
 traceback.print_exc();sys.exit(1)
