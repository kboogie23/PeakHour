"""Synthetic djay for Windows libraries for tests (no real library data).

Records follow the layout observed in a real djay 5.6 for Windows library:
FastCoding blobs with doubles for numbers, a URL-object location holding
file:///C:%5C..., and no mediaItems collection.
"""
import sqlite3,struct

def blob(value):
    """FastCoding blob: str, float (double), list, or (class, {key: value}) object."""
    b=bytearray(b'TSAF\x03\x00\x03\x00'+bytes(12));counts=[0,0]  # objects, strings
    def pad(n): b.extend(bytes((n-len(b)%n)%n))
    def put(v):
        if isinstance(v,str): b.extend(b'\x08'+v.encode()+b'\x00');counts[1]+=1
        elif isinstance(v,float): b.append(20);pad(8);b.extend(struct.pack('<d',v))
        elif isinstance(v,list): counts[0]+=1;b.append(11);pad(4);b.extend(struct.pack('<I',len(v)));[put(x) for x in v]
        else:
            counts[0]+=1;b.append(43);put(v[0])
            for k,x in v[1].items(): put(x);put(k)
            b.append(0)
    put(value);struct.pack_into('<III',b,8,counts[0],0,counts[1]);return bytes(b)

def user_data(key,title,play_count=None):
    fields={'uuid':key,'titleIDs':[title_id(key,title)]}
    if play_count is not None: fields['playCount']=play_count
    return blob(('ADCMediaItemUserData',fields))

def title_id(key,title):
    return ('ADCMediaItemTitleID',{'uuid':key,'title':title,'artist':'Fixture Artist','duration':136.5})

def windows_library(folder,name,play_count,quote,key='w1'):
    """Write <name>.mp3 and <name>.db (one track) into folder; return both paths."""
    t=folder/(name+'.mp3');t.write_bytes(b'fixture')
    url=b'file://'+quote(str(t),safe='/&():').encode()
    rows=[('localMediaItemLocations',key,b'\x2b\x08ADCMediaItemLocation\x00\x21\x08'+url+b'\x00\x00\x08sourceURIs\x00\x00'),
          ('mediaItemUserData',key,user_data(key,name,play_count)),
          ('mediaItemTitleIDs',key,blob(title_id(key,name))),
          ('mediaItemAnalyzedData',key,blob(('ADCMediaItemAnalyzedData',{'uuid':key,'titleIDs':[title_id(key,name)],'bpm':105.5})))]
    d=folder/(name+'.db');c=sqlite3.connect(d)
    c.execute('create table database2(rowid integer primary key,collection text,key text,data blob,metadata blob)')
    c.executemany('insert into database2(collection,key,data) values(?,?,?)',rows);c.commit();c.close()
    return t,d
