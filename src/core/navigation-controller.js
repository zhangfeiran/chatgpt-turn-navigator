  function createNavigationController(scope) {
    let current=null, serial=0;
    const owns=t=>!!t && current===t && t.scope===scope();
    const live=t=>owns(t) && !t.cancelled;
    function begin(kind) {
      if(current) {current.cancelled=true;current.reason='superseded';}
      current={id:++serial,kind,scope:scope(),cancelled:false,reason:''};return current;
    }
    function cancel(reason='user') {
      if(current) {current.cancelled=true;current.reason=reason;}
    }
    function write(t,el,top,restore=false) {
      if(!el?.isConnected || !owns(t) || (t.cancelled && !(restore && t.reason==='stop'))) return false;
      const overflow=Math.max(0,el.scrollHeight-el.clientHeight);
      const reverse=getComputedStyle(el).flexDirection==='column-reverse';
      el.scrollTo({top:Math.max(reverse?-overflow:0,Math.min(reverse?0:overflow,top)),behavior:'instant'});
      return true;
    }
    return {begin,cancel,owns,live,write,get current(){return current;},
      finish(t){if(current===t) current=null;},
      summary(){return current?{kind:current.kind,cancelled:current.cancelled,reason:current.reason}:null;}
    };
  }

