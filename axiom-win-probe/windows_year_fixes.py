"""Release-year repairs for AXIOM Health: dropped apostrophes and the empty Fix Eras list.

1. Catalog lookups with dropped apostrophes. Store downloads are often tagged
   "Im Still In Love With You" or "Dont Stop". Apple Music and MusicBrainz
   find nothing for "im"/"dont", so the lookup failed for well-known songs
   (Al Green's 1972 "I'm Still In Love With You" returned no match from every
   source), AXIOM tried about ten MusicBrainz query variants per song, ran
   into MusicBrainz's rate limit ("MusicBrainz is busy"), and the song was left
   without a year or given the file's date. Each year provider is now asked
   first with the contractions restored ("I'm", "don't"); the original title is
   still tried when that finds nothing.

2. Fix Eras listing nothing. Health counts songs with no year, but the Smart
   view (also what an empty "Search Library" runs) lists only songs it can
   suggest an era for, so those songs never appeared and "Scan details"
   showed 0 to place manually. The Smart view now adds, as Manual rows, songs
   whose year is missing or was guessed from the file's date or folder (catalog
   matches AXIOM labels "approximate" are not listed), built by AXIOM's own
   search so the rows and their year/era controls are unchanged.
"""
import functools
import os
import re

CONTRACTIONS = {
    'im': "i'm", 'ive': "i've", 'dont': "don't", 'cant': "can't", 'wont': "won't", 'aint': "ain't",
    'isnt': "isn't", 'arent': "aren't", 'doesnt': "doesn't", 'didnt': "didn't", 'wasnt': "wasn't",
    'werent': "weren't", 'couldnt': "couldn't", 'shouldnt': "shouldn't", 'wouldnt': "wouldn't",
    'havent': "haven't", 'hasnt': "hasn't", 'hadnt': "hadn't", 'youre': "you're", 'youve': "you've",
    'youll': "you'll", 'youd': "you'd", 'theyre': "they're", 'theyve': "they've", 'theyll': "they'll",
    'weve': "we've", 'thats': "that's", 'whats': "what's", 'theres': "there's", 'heres': "here's",
    'wheres': "where's", 'whos': "who's", 'lets': "let's", 'shes': "she's", 'hes': "he's",
    'ima': "i'ma", 'yall': "y'all", 'nothin': "nothin'", 'somethin': "somethin'", 'lovin': "lovin'",
}  # ambiguous words (its, ill, id, were, well, hell, shell, wed) are left alone
_WORD = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
PROVIDERS = ('_musicbrainz_year_lookup', '_apple_music_year_lookup', '_spotify_year_lookup',
             '_discogs_year_lookup', '_lastfm_year_lookup')
MANUAL_ROW_LIMIT = 500


def restore_contractions(title):
    """The title with dropped apostrophes restored, or None when nothing changes."""
    def fix(match):
        word = match.group(0)
        restored = CONTRACTIONS.get(word.casefold())
        if restored is None:
            return word
        return restored.capitalize() if word[0].isupper() else restored
    text = str(title or '')
    restored = _WORD.sub(fix, text)
    return restored if restored != text else None


def with_contractions(provider):
    @functools.wraps(provider)
    def lookup(artist, title, *args, **kwargs):
        restored = restore_contractions(title)
        if restored:
            result = provider(artist, restored, *args, **kwargs)
            if result and (not isinstance(result, dict) or result.get('year')):
                return result
        return provider(artist, title, *args, **kwargs)
    lookup._windows_contractions = True
    return lookup


GUESSED_SOURCES = ('file_date', 'folder_year')  # years AXIOM inferred from the file, not from a catalog


def unresolved_year(track, coerce_year):
    """No year at all, or one guessed from the file's date or folder."""
    if not coerce_year(track.get('year')):
        return True
    sources = ' '.join(str(track.get(key) or '') for key in ('year_source', 'year_health_source')).lower()
    return any(marker in sources for marker in GUESSED_SOURCES)


def make_era_audit(original, coerce_year):
    """Smart view plus Manual rows for songs with no year, or only a year guessed from the file."""
    @functools.wraps(original)
    def build_era_audit(tracks, *args, **kwargs):
        result = original(tracks, *args, **kwargs)
        mode = kwargs.get('mode', args[1] if len(args) > 1 else 'smart')
        query = kwargs.get('query', args[0] if args else '')
        if mode != 'smart' or str(query or '').strip() or not isinstance(result, dict):
            return result
        listed = {row.get('path') for row in result.get('rows') or []}
        added = []
        unresolved = [t for t in tracks or [] if isinstance(t, dict) and t.get('path') and t.get('path') not in listed
                      and unresolved_year(t, coerce_year)]
        for track in unresolved[:MANUAL_ROW_LIMIT]:
            name = os.path.basename(str(track['path']))
            rows = original([track], query=name, mode='search').get('rows') or []
            for row in rows[:1]:
                estimate = coerce_year(track.get('year'))
                row['confidence'] = 'manual'
                row['reason'] = (f'{estimate} is only an estimate from the file date, not a verified release year. '
                                 'Enter the year, choose an era, or run Find Original Years.' if estimate else
                                 'No release year yet. Enter the year, choose an era, or run Find Original Years.')
                added.append(row)
        if added:
            result['rows'] = list(result.get('rows') or []) + added
            summary = result.setdefault('summary', {})
            summary['review'] = int(summary.get('review') or 0) + len(unresolved)
            summary['results'] = int(summary.get('results') or 0) + len(unresolved)
        return result
    build_era_audit._windows_manual_rows = True
    return build_era_audit


def install(app):
    for name in PROVIDERS:
        provider = getattr(app, name, None)
        if callable(provider) and not getattr(provider, '_windows_contractions', False):
            setattr(app, name, with_contractions(provider))
    import era_audit
    if not getattr(app.build_era_audit, '_windows_manual_rows', False):
        app.build_era_audit = make_era_audit(app.build_era_audit, era_audit._coerce_year)
