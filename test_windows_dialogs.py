import os,pathlib,sys,threading,time,unittest
from unittest.mock import patch,MagicMock
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent/'axiom-win-probe'))
import windows_dialogs as wd
class DialogTests(unittest.TestCase):
 def test_folder_and_cancel(self):
  root=MagicMock()
  with patch.object(wd.tk,'Tk',return_value=root),patch.object(wd.filedialog,'askdirectory',return_value=''):
   self.assertEqual(wd.choose_folder_dialog(),('',True));root.destroy.assert_called_once()
 def test_file_selection_and_cleanup(self):
  root=MagicMock(); expected=str(pathlib.Path(__file__).resolve())
  with patch.object(wd.tk,'Tk',return_value=root),patch.object(wd.filedialog,'askopenfilename',return_value=expected):
   self.assertEqual(wd.choose_serato_database_dialog(),(os.path.normpath(expected),False));root.destroy.assert_called_once()
 def test_cleanup_on_error(self):
  root=MagicMock()
  with patch.object(wd.tk,'Tk',return_value=root),patch.object(wd.filedialog,'askdirectory',side_effect=RuntimeError('failure')):
   with self.assertRaises(RuntimeError):wd.choose_folder_dialog()
   root.destroy.assert_called_once()
def _watchers():
 return [t for t in threading.enumerate() if t.name=='peak-hour-raise-dialog' and t.is_alive()]
class RaiseDialogTests(unittest.TestCase):
 def test_dialog_is_raised_topmost_and_watcher_ends(self):
  root=MagicMock(); user32=MagicMock()
  def slow_chooser(**options):
   time.sleep(0.3)
   return 'C:\\Music'
  with patch.object(wd.tk,'Tk',return_value=root),patch.object(wd,'_user32',user32),patch.object(wd,'find_dialog_window',return_value=1234),\
       patch.object(wd.filedialog,'askdirectory',side_effect=slow_chooser):
   self.assertEqual(wd.choose_folder_dialog(),(os.path.normpath(os.path.abspath('C:\\Music')),False))
  calls=[c for c in user32.SetWindowPos.call_args_list if c.args and c.args[0]==1234]
  self.assertTrue(calls,'SetWindowPos was not called for the dialog window')
  args=calls[0].args
  self.assertEqual(args[1],-1)  # HWND_TOPMOST
  self.assertEqual(args[2:6],(0,0,0,0))
  flags=args[6]
  self.assertEqual(flags,0x0001|0x0002|0x0040)  # no size, no move, show window
  user32.BringWindowToTop.assert_any_call(1234)
  user32.SetForegroundWindow.assert_any_call(1234)
  self.assertEqual(_watchers(),[],'the watcher thread is still running after the dialog returned')
  root.destroy.assert_called_once()
 def test_watcher_stops_at_once_when_no_dialog_appears(self):
  root=MagicMock(); started=time.monotonic()
  with patch.object(wd.tk,'Tk',return_value=root),patch.object(wd,'_user32',MagicMock()),patch.object(wd,'find_dialog_window',return_value=None),\
       patch.object(wd.filedialog,'askdirectory',return_value=''):
   self.assertEqual(wd.choose_folder_dialog(),('',True))
  self.assertLess(time.monotonic()-started,2.0)
  self.assertEqual(_watchers(),[])
 def test_watcher_exception_does_not_break_the_dialog(self):
  root=MagicMock()
  def chooser(**options):
   time.sleep(0.3)
   return 'C:\\Music'
  with patch.object(wd.tk,'Tk',return_value=root),patch.object(wd,'_user32',MagicMock()),\
       patch.object(wd,'find_dialog_window',side_effect=OSError('enumerate failed')),patch.object(wd.filedialog,'askdirectory',side_effect=chooser):
   self.assertEqual(wd.choose_folder_dialog(),(os.path.normpath(os.path.abspath('C:\\Music')),False))
  self.assertEqual(_watchers(),[]); root.destroy.assert_called_once()
 def test_exception_while_raising_is_swallowed(self):
  user32=MagicMock(); user32.SetWindowPos.side_effect=OSError('denied')
  with patch.object(wd,'_user32',user32),patch.object(wd,'find_dialog_window',return_value=1234):
   wd._raise_dialog(threading.Event())  # must not raise
 def test_chooser_error_still_stops_watcher(self):
  root=MagicMock()
  with patch.object(wd.tk,'Tk',return_value=root),patch.object(wd,'_user32',MagicMock()),patch.object(wd,'find_dialog_window',return_value=None),\
       patch.object(wd.filedialog,'askdirectory',side_effect=RuntimeError('failure')):
   with self.assertRaises(RuntimeError):wd.choose_folder_dialog()
  self.assertEqual(_watchers(),[]); root.destroy.assert_called_once()
 def test_find_dialog_window_without_dialog_is_none(self):
  self.assertIsNone(wd.find_dialog_window())
 def _windows(self,windows):
  """A fake user32 whose EnumWindows visits windows = [(hwnd, class name, owner hwnd, visible, pid)] in order."""
  user32=MagicMock(); owners={w[0]:w[2] for w in windows}; info={w[0]:w for w in windows}; asked=[]
  def enum(proc,lparam):
   for w in windows:
    if not proc(w[0],0):break
   return 1
  def thread_process(hwnd,ref):
   ref._obj.value=info[hwnd][4];return 1
  def class_name(hwnd,buffer,size):
   buffer.value=info[hwnd][1];return len(info[hwnd][1])
  def get_window(hwnd,command):
   asked.append((hwnd,command));return owners[hwnd]
  user32.EnumWindows.side_effect=enum;user32.GetWindowThreadProcessId.side_effect=thread_process
  user32.IsWindowVisible.side_effect=lambda hwnd:info[hwnd][3];user32.GetClassNameW.side_effect=class_name;user32.GetWindow.side_effect=get_window
  user32.asked=asked
  return user32
 def test_find_dialog_window_owner_filter(self):
  me=os.getpid(); OWNER=500; OTHER=600
  windows=[(1,'#32770',OTHER,True,me),     # a dialog of this process owned by someone else: ignored when an owner is given
           (2,'Notepad',OWNER,True,me),    # right owner, wrong class
           (3,'#32770',OWNER,False,me),    # right owner, not visible
           (4,'#32770',OWNER,True,me+1),   # right owner, another process
           (5,'#32770',OWNER,True,me),     # the one
           (6,'#32770',OWNER,True,me)]
  user32=self._windows(windows)
  with patch.object(wd,'_user32',user32):
   self.assertEqual(wd.find_dialog_window(OWNER),5)
   self.assertEqual(wd.find_dialog_window(OTHER),1)
   self.assertEqual(wd.find_dialog_window(),1)    # no owner: the first dialog of this process, whoever owns it
   self.assertEqual(wd.find_dialog_window(None),1)
   self.assertIsNone(wd.find_dialog_window(777))  # an owner that owns nothing
  self.assertIn((1,wd._GW_OWNER),user32.asked)  # the owner is read with GW_OWNER
  only_other=self._windows([(1,'#32770',OTHER,True,me)])
  with patch.object(wd,'_user32',only_other):
   self.assertIsNone(wd.find_dialog_window(OWNER),'a dialog with a different owner must not be taken')
   self.assertEqual(wd.find_dialog_window(OTHER),1)
 def test_raise_dialog_passes_the_owner(self):
  user32=MagicMock(); seen=[]
  def finder(owner=None):
   seen.append(owner);return 4321
  with patch.object(wd,'_user32',user32),patch.object(wd,'find_dialog_window',side_effect=finder):
   wd._raise_dialog(threading.Event(),owner=500)
  self.assertEqual(seen,[500]); self.assertTrue([c for c in user32.SetWindowPos.call_args_list if c.args[0]==4321])
 def test_raise_dialog_with_a_zero_argument_stand_in(self):
  user32=MagicMock(); calls=[]
  def finder():
   calls.append('no arguments');return 4321
  with patch.object(wd,'_user32',user32),patch.object(wd,'find_dialog_window',finder):
   wd._raise_dialog(threading.Event(),owner=500)  # find_dialog_window(500) raises TypeError, the no-argument call is the fallback
   wd._raise_dialog(threading.Event())
  self.assertEqual(calls,['no arguments','no arguments'])
  self.assertEqual(len([c for c in user32.SetWindowPos.call_args_list if c.args[0]==4321]),2)
  user32.BringWindowToTop.assert_any_call(4321)
 def test_choose_dialog_works_with_a_zero_argument_stand_in(self):
  root=MagicMock(); root.wm_frame.return_value='0x1f4'
  def finder():
   return 1234
  def chooser(**options):
   time.sleep(0.3);return 'C:\\Music'
  user32=MagicMock()
  with patch.object(wd.tk,'Tk',return_value=root),patch.object(wd,'_user32',user32),patch.object(wd,'find_dialog_window',finder),\
       patch.object(wd.filedialog,'askdirectory',side_effect=chooser):
   self.assertEqual(wd.choose_folder_dialog(),(os.path.normpath(os.path.abspath('C:\\Music')),False))
  self.assertTrue([c for c in user32.SetWindowPos.call_args_list if c.args and c.args[0]==1234])
  self.assertEqual(_watchers(),[])
 def test_the_tk_frame_is_the_owner_the_watcher_looks_for(self):
  root=MagicMock(); root.wm_frame.return_value='0x1f4'; seen=[]
  def finder(owner=None):
   seen.append(owner);return None
  def chooser(**options):
   time.sleep(0.25);return ''
  with patch.object(wd.tk,'Tk',return_value=root),patch.object(wd,'_user32',MagicMock()),patch.object(wd,'find_dialog_window',finder),\
       patch.object(wd.filedialog,'askdirectory',side_effect=chooser):
   wd.choose_folder_dialog()
  self.assertTrue(seen and set(seen)=={0x1f4},seen)
if __name__=='__main__':
 result=unittest.main(exit=False).result
 if not result.wasSuccessful():sys.exit(1)
 print('PASS: folder and file dialogs return the choice, report cancel, always close the window, and a watcher raises the dialog topmost then ends')
