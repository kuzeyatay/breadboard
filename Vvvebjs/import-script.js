const importScript = (src, load) => {
    return new Promise((resolve, reject) => {
	
	if (document.getElementById(src)) {
		return resolve();
	};  
    
    const script = document.createElement('script')
    if (src.endsWith(".js")) {
		script.src = src;
	} else {
		script.src =  import.meta.resolve("./../" + src + ".js");//import.meta.resolve( src);
	}
	
    script.async = false
    script.id = src;
    document.body.appendChild(script)

	script.onload = () => resolve();
    script.onerror = (err) => reject(err);
    /*
    return () => {
      document.body.removeChild(script)
    }*/
  }, [src])
}

const importCss = (src, load) => {
    return new Promise((resolve, reject) => {
	
	if (document.getElementById(src)) {
		return resolve();
	};  
    const link = document.createElement('link')
    link.href =  src;
    link.async = false
    link.rel = "stylesheet"
    link.id = src;
    document.head.appendChild(link)

	link.onload = () => resolve();
    link.onerror = (err) => reject(err);
    /*
    return () => {
      document.body.removeChild(link)
    }*/
  }, [src])
}

export { importCss, importScript  };
