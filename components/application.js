const Cc = Components.classes;
const Ci = Components.interfaces;

var subscriptLoader = Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
    .getService(Components.interfaces.mozIJSSubScriptLoader);

function application () {
    this.wrappedJSObject = this;
    this.conkeror = this;
    this.window_watcher = Cc["@mozilla.org/embedcomp/window-watcher;1"].getService(Ci.nsIWindowWatcher);
    this.Cc = Cc;
    this.Ci = Ci;
    this.subscript_loader = Cc["@mozilla.org/moz/jssubscript-loader;1"].getService(Ci.mozIJSSubScriptLoader);
    this.preferences = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefBranch);
    var conkeror = this;
    this.modules_loaded = [];
    function load_module (module_name) {
        try {
            conkeror.subscript_loader.loadSubScript("chrome://conkeror-modules/content/" + module_name,
                                                conkeror);
            conkeror.modules_loaded.push(module_name);
        } catch (e) {
            dump("Failed to load module: " + module_name + "\n" +
                 e + "\n");
        }
    }
    function require (module) {
        if (conkeror.modules.indexOf(module) == -1)
            load_module(module);
    }
    this.load_module = load_module;
    this.require = require;

    load_module("debug.js");
    load_module("localfile.js");
    load_module("utils.js");
    load_module("keyboard.js");
    load_module("buffer.js");
    load_module("frame.js");
    load_module("interactive.js");
    load_module("daemon-mode.js");
    load_module("mode-line.js");
    load_module("save.js");

    load_module("commands.js"); // depends: interactive.js
    load_module("frameset.js"); // depends interactive.js
    load_module("webjump.js"); // depends: interactive.js
    load_module("minibuffer.js"); // depends: interactive.js

    load_module("bindings.js"); // depends: keyboard.js

    load_module("find.js");
    load_module("numberedlinks.js");

    this.start_time = Date.now ();

    conkeror.url_remoting_fn = conkeror.make_frame;

    conkeror.set_default_directory ();

    conkeror.init_webjumps ();

    conkeror.init_window_title ();
}

application.prototype = {

version: "$CONKEROR_VERSION$", // preprocessor variable

start_time: null,
window_watcher: null,
preferences: null,
chrome: "chrome://conkeror/content/conkeror.xul",
homepage: "chrome://conkeror/content/help.html",
default_directory: null,
url_remoting_fn: null,
commands: [],
current_command: null,
quit_hook: [],
make_frame_hook: [],
make_frame_after_hook: [],
dom_content_loaded_hook: [],
buffer_title_change_hook: [],
browser_buffer_finished_loading_hook: [],
browser_buffer_progress_change_hook: [],
browser_buffer_location_change_hook: [],
browser_buffer_status_change_hook: [],
select_buffer_hook: [],
frame_resize_hook: [],
frame_initialize_early_hook: [],
frame_initialize_hook: [],
frame_initialize_late_hook: [],
mode_line_enabled: true,

add_hook: function (hook, func, append)
{
    if (hook.indexOf (func) != -1) return;
    if (append)
        hook.push (func);
    else
        hook.unshift (func);
},

run_hooks: function (hooks)
{
    var args = Array.prototype.slice.call(arguments, 1);
    for (var i in hooks) {
        try
        {
            hooks[i].apply (null, args);
        } catch (e) {
            dump ('run_hooks: '+e+"\n");
        }
    }
},

generate_new_frame_tag: function (tag)
{
    var existing = [];
    var exact_match = false;
    var en = this.window_watcher.getWindowEnumerator ();
    if (tag == '') { tag = null; }
    var re;
    if (tag) {
        re = new RegExp ("^" + tag + "<(\\d+)>$");
    } else {
        re = new RegExp ("^(\\d+)$");
    }
    while (en.hasMoreElements ()) {
        var w = en.getNext().QueryInterface (Components.interfaces.nsIDOMWindow);
        if ('tag' in w)  {
            if (tag && w.tag == tag) {
                exact_match = true;
                continue;
            }
            var re_result = re.exec (w.tag);
            if (re_result)
                existing.push (re_result[1]);
        }
    }
    if (tag && ! exact_match)
        return tag;

    existing.sort (function (a, b) { return a - b; });

    var n = 1;
    for (var i = 0; i < existing.length; i++) {
        if (existing[i] < n) continue;
        if (existing[i] == n) { n++; continue; }
        break;
    }
    if (tag) {
        return tag + "<" + n + ">";
    } else {
        return n;
    }
},

encode_xpcom_structure: function (data)
{
    var ret = null;
    if (typeof data == 'string') {
        ret = Components.classes["@mozilla.org/supports-string;1"]
            .createInstance(Components.interfaces.nsISupportsString);
        ret.data = data;
    } else if (typeof data == 'object') { // should be a check for array.
        ret = Components.classes["@mozilla.org/array;1"]
            .createInstance(Components.interfaces.nsIMutableArray);
        for (var i = 0; i < data.length; i++) {
            ret.appendElement (this.encode_xpcom_structure (data[i]), false);
        }
    } else {
        throw 'make_xpcom_struct was given something other than String or Array';
    }
    return ret;
},

decode_xpcom_structure: function (data)
{
    function dostring (data) {
        try {
            var iface = data.QueryInterface (Components.interfaces.nsISupportsString);
            return iface.data;
        } catch (e) {
            return null;
        }
    }

    var ret = dostring (data);
    if (ret) { return ret; }
    // it's not a string, so we will assume it is an array.
    ret = [];
    var en = data.QueryInterface (Components.interfaces.nsIArray).enumerate ();
    while (en.hasMoreElements ()) {
        ret.push (this.decode_xpcom_structure (en.getNext ()));
    }
    return ret;
},

make_frame: function (url, tag)
{
    var open_args = ['conkeror'];
    if (url) { open_args.push (['find'].concat (url)); }
    if (tag) { open_args.push (['tag', tag]); }
    open_args = this.encode_xpcom_structure (open_args);
    var result = this.window_watcher.openWindow(null,
                                                this.chrome,
                                                null,
                                                "resizable=yes,dialog=no",
                                                open_args);
    this.run_hooks (this.make_frame_hook, result);
    return result;
},

// The simple case for find_url_new_buffer is to just load an url into
// an existing frame.  However, find_url_new_buffer must also deal
// with the case where it is called many times synchronously (as by a
// command-line handler) when there is no active frame into which to
// load urls.  We only want to make one frame, so we keep a queue of
// urls to load, and put a function in `make_frame_after_hook' that
// will load those urls.
//
find_url_new_buffer_queue: null,
find_url_new_buffer: function (url, frame)
{
    function  find_url_new_buffer_internal () {
        // get urls from queue
        if (this.conkeror.find_url_new_buffer_queue) {
            for (var i = 0; i < this.conkeror.find_url_new_buffer_queue.length; i++) {
                this.conkeror.find_url_new_buffer (
                    this.conkeror.find_url_new_buffer_queue[i],
                    this);
            }
            // reset queue
            this.conkeror.find_url_new_buffer_queue = null;
        }
    }

    // window_watcher.activeWindow is the default frame, but it may be
    // null, too.
    //
    if (frame == null) {
        frame = this.window_watcher.activeWindow;
    }
    if (frame) {
        return frame.newBrowser(url);
    } else if (this.find_url_new_buffer_queue) {
        // we are queueing
        this.find_url_new_buffer_queue.push (url);
    } else {
        // establish a queue and make a frame
        this.find_url_new_buffer_queue = [];
        this.add_hook (this.make_frame_after_hook, find_url_new_buffer_internal);
        frame = this.make_frame (url);
        return frame;
    }
},

get_frame_by_tag : function (tag)
{
    var en = this.window_watcher.getWindowEnumerator ();
    while (en.hasMoreElements ()) {
        var w = en.getNext().QueryInterface (Components.interfaces.nsIDOMWindow);
        if ('tag' in w && w.tag == tag)
            return w;
    }
    return null;
},

quit : function ()
{
    this.run_hooks (this.quit_hook);
    // this.daemon_mode (-1);
    var appStartup = Components.classes["@mozilla.org/toolkit/app-startup;1"]
        .getService(Components.interfaces.nsIAppStartup);
    appStartup.quit(appStartup.eAttemptQuit);
},

get_os: function ()
{
    // possible return values: 'Darwin', 'Linux', 'WINNT', ...
    var appinfo = Components.classes['@mozilla.org/xre/app-info;1']
        .createInstance (Components.interfaces.nsIXULRuntime);
    return appinfo.OS;
},

set_default_directory : function (directory_s) {
    function getenv (variable) {
        var env = Components.classes['@mozilla.org/process/environment;1']
            .createInstance (Components.interfaces.nsIEnvironment);
        if (env.exists (variable))
            return env.get(variable);
        return null;
    }

    if (! directory_s)
    {
        directory_s = getenv ('HOME');
    }

    if (! directory_s &&
        this.get_os() == "WINNT")
    {
        directory_s = getenv ('USERPROFILE') ||
            getenv ('HOMEDRIVE') + getenv ('HOMEPATH');
    }
    this.default_directory = Components.classes["@mozilla.org/file/local;1"]
        .createInstance(Components.interfaces.nsILocalFile);
    this.default_directory.initWithPath (directory_s);
},

/*
 * path_s: string path to load.  may be a file, a directory, or null.
 *   if it is a file, that file will be loaded.  if it is a directory,
 *   all `.js' files in that directory will be loaded.  if it is null,
 *   the preference `conkeror.rcfile' will be read for the default.
 */
load_rc : function (path_s)
{
    // make `conkeror' object visible to the scope of the rc.
    var conkeror = this;

    function load_rc_file(file)
    {
        var fd = conkeror.fopen (file, "<");
        var s = fd.read ();
        fd.close ();
        try {
            eval.call (conkeror, s);
        } catch (e) { dump (e + "\n");}
    }

    function load_rc_directory (file_o) {
        var entries = file_o.directoryEntries;
        var files = [];
        while (entries.hasMoreElements ()) {
            var entry = entries.getNext ();
            entry.QueryInterface (Components.interfaces.nsIFile);
            if (entry.leafName.match(/^[^.].*\.js$/i)) {
                files.push(entry);
            }
        }
        files.sort(function (a, b) {
                if (a.leafName < b.leafName) {
                    return -1;
                } else if (a.leafName > b.leafName) {
                    return 1;
                } else {
                    return 0;
                }
            });
        for (var i = 0; i < files.length; i++) {
            load_rc_file(files[i]);
        }
    }

    if (! path_s)
    {
        if (conkeror.preferences.prefHasUserValue ("conkeror.rcfile")) {
            var rcfile = conkeror.preferences.getCharPref("conkeror.rcfile");
            if (rcfile.length)
                path_s = rcfile;
        }
    }

    var file_o = Components.classes["@mozilla.org/file/local;1"]
        .createInstance(Components.interfaces.nsILocalFile);
    file_o.initWithPath(path_s);
    if (file_o.isDirectory()) {
        load_rc_directory (file_o);
    } else {
        load_rc_file (path_s);
    }
},

// nsISupports
QueryInterface: function (aIID) {
        if (! aIID.equals (Components.interfaces.nsISupports))
            throw Components.results.NS_ERROR_NO_INTERFACE;
        return this;
    }
};


///
/// Factory
///

var application_factory = {
createInstance: function (aOuter, aIID) {
        if (aOuter != null)
            throw Components.results.NS_ERROR_NO_AGGREGATION;
        return (new application ()).QueryInterface (aIID);
    }
};


///
/// Module
///

const CLASS_ID = Components.ID('{72a7eea7-a894-47ec-93a9-a7bc172cf1ac}');
const CLASS_NAME = "application";
const CONTRACT_ID = "@conkeror.mozdev.org/application;1";

var application_module = {
_firstTime: true,
registerSelf: function(aCompMgr, aFileSpec, aLocation, aType)
{
    if (this._firstTime) {
        this._firstTime = false;
        throw Components.results.NS_ERROR_FACTORY_REGISTER_AGAIN;
    };
    aCompMgr = aCompMgr.QueryInterface(Components.interfaces.nsIComponentRegistrar);
    aCompMgr.registerFactoryLocation(CLASS_ID, CLASS_NAME, CONTRACT_ID, aFileSpec, aLocation, aType);
},

unregisterSelf: function(aCompMgr, aLocation, aType)
{
    aCompMgr = aCompMgr.QueryInterface(Components.interfaces.nsIComponentRegistrar);
    aCompMgr.unregisterFactoryLocation(CLASS_ID, aLocation);
},

getClassObject: function(aCompMgr, aCID, aIID)
{
    if (!aIID.equals(Components.interfaces.nsIFactory))
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;

    if (aCID.equals(CLASS_ID))
        return application_factory;

    throw Components.results.NS_ERROR_NO_INTERFACE;
},

canUnload: function(aCompMgr) { return true; }
};

/* The NSGetModule function is the magic entry point that XPCOM uses to find what XPCOM objects
 * this component provides
 */
function NSGetModule(comMgr, fileSpec)
{
  return application_module;
}
