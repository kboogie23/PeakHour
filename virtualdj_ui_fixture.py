import pathlib,sys
from flask import Flask
root=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(root/'axiom-win-probe'))
from windows_virtualdj_api import create_virtualdj_blueprint
fixtures=root/'fixtures'/'virtualdj-ui';fixtures.mkdir(parents=True,exist_ok=True)
db=fixtures/'database.xml';listing=fixtures/'set.xml'
db.write_text('<VirtualDJ_Database Version="8.1"><Song FilePath="C:\\Music\\one.mp3"><Tags Author="Fixture DJ" Title="Test Song"/><Scan Bpm="0.5"/></Song><Song FilePath="C:\\Video\\clip.vob"><Tags Title="Test Video"/></Song></VirtualDJ_Database>',encoding='utf8')
listing.write_text('<VirtualFolder ordered="yes"><song path="C:/Music/one.mp3"/><song path="C:/Video/clip.vob"/><song path="C:/missing.mp4"/></VirtualFolder>',encoding='utf8')
app=Flask(__name__,static_folder=str(root/'axiom-win-probe'/'static'));app.register_blueprint(create_virtualdj_blueprint(lambda p:p in (db,listing),lambda _:None,lambda kind:(str(db if kind=='database' else listing),False)))
@app.get('/')
def page():return '''<!doctype html><title>VirtualDJ UI fixture</title><link rel="stylesheet" href="/static/css/windows-virtualdj.css"><button id="connect-virtualdj-inspect" hidden onclick="AxiomWindowsVirtualDJ.open()">Inspect VirtualDJ</button><script src="/static/js/shared/windows-virtualdj.js"></script>'''
if __name__=='__main__':app.run(host='127.0.0.1',port=48768,debug=False,use_reloader=False)
