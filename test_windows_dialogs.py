import os,pathlib,sys,unittest
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
if __name__=='__main__':
 result=unittest.main(exit=False).result
 if not result.wasSuccessful():sys.exit(1)
 print('PASS: folder and file dialogs return the choice, report cancel and always close the window')
