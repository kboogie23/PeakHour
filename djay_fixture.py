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

PLAYLIST_TABLES=['CREATE UNIQUE INDEX "true_primary_key" ON "database2" ( "collection", "key" )',
 'CREATE TABLE "yap2" ("extension" CHAR NOT NULL,   "key" CHAR NOT NULL,   "data" BLOB,   PRIMARY KEY ("extension", "key") )',
 'CREATE TABLE "relationship_relationship" ("rowid" INTEGER PRIMARY KEY,  "name" CHAR NOT NULL,  "src" INTEGER NOT NULL,  "dst" BLOB NOT NULL,  "rules" INTEGER,  "manual" INTEGER )',
 'CREATE INDEX "src_name" ON "relationship_relationship" ("src", "name")',
 'CREATE INDEX "dst_name" ON "relationship_relationship" ("dst", "name")',
 'CREATE TABLE "secondaryIndex_mediaItemPlaylistIndex" ("rowid" INTEGER PRIMARY KEY, "name" TEXT)',
 'CREATE VIRTUAL TABLE "fts_searchIndex" USING fts4("title", "artist", "genre", "album", "grouping", "comments", "composer", "playlist", tokenize=unicode61 "tokenchars=-_@.#")']
for _view in ('mediaView','mediaItemPlaylistsView','mediaItemPlaylistView'):
    PLAYLIST_TABLES+=[f'CREATE TABLE "view_{_view}_map" ("rowid" INTEGER PRIMARY KEY,  "pageKey" CHAR NOT NULL )',
     f'CREATE TABLE "view_{_view}_page" ("pageKey" CHAR NOT NULL PRIMARY KEY,  "group" CHAR NOT NULL,  "prevPageKey" CHAR,  "count" INTEGER,  "data" BLOB )']

def djay_library(folder,names,quote,name='library',keys=None):
    """One synthetic djay for Windows library in folder: a real file, location, mediaItems, user data and title record per
    name (key 'k1', 'k2', ... unless keys are given), the tables and views djay keeps playlists in, and djay's empty playlist root.
    Returns ({name: path}, database path)."""
    paths,rows={},[]
    for number,song in enumerate(names,1):
        key=keys[number-1] if keys else f'k{number}';t=folder/(song+'.mp3');t.write_bytes(b'fixture');paths[song]=str(t)
        url=b'file://'+quote(str(t),safe='/&():').encode()
        rows+=[('localMediaItemLocations',key,b'\x2b\x08ADCMediaItemLocation\x00\x21\x08'+url+b'\x00\x00\x08sourceURIs\x00\x00'),
               ('mediaItems',key,blob(('ADCMediaItem',{'uuid':key,'titleIDs':[title_id(key,song)]}))),
               ('mediaItemUserData',key,user_data(key,song,1.0)),
               ('mediaItemTitleIDs',key,blob(title_id(key,song)))]
    rows.append(('mediaItemPlaylists','mediaItemPlaylist-root',blob(('ADCMediaItemPlaylist',{'uuid':'mediaItemPlaylist-root','name':'Playlists','type':1.0}))))
    d=folder/(name+'.db');c=sqlite3.connect(d)
    c.execute('create table database2(rowid integer primary key,collection text,key text,data blob,metadata blob)')
    for ddl in PLAYLIST_TABLES: c.execute(ddl)
    c.executemany('insert into database2(collection,key,data) values(?,?,?)',rows)
    root=c.execute("select rowid from database2 where key='mediaItemPlaylist-root'").fetchone()[0]
    c.execute('insert into secondaryIndex_mediaItemPlaylistIndex(rowid,name) values(?,?)',(root,'Playlists'))
    c.execute('insert into fts_searchIndex(rowid,playlist) values(?,?)',(root,'Playlists'))
    c.execute('insert into view_mediaItemPlaylistsView_page values(?,?,?,?,?)',('A6705E9A-FD57-BC0C-5E76-C8F7E276354D','root',None,1,struct.pack('<Q',root)))
    c.execute('insert into view_mediaItemPlaylistsView_map values(?,?)',(root,'A6705E9A-FD57-BC0C-5E76-C8F7E276354D'))
    c.commit();c.close()
    return paths,d
