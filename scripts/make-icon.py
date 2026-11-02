from pathlib import Path
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parent.parent
size=512
im=Image.new('RGBA',(size,size),(0,0,0,0));d=ImageDraw.Draw(im)
d.rounded_rectangle((16,16,496,496),radius=110,fill='#8bc541',outline='#f4ffe3',width=14)
d.rounded_rectangle((38,38,474,474),radius=90,outline='#b8e27b',width=4)
d.ellipse((92,397,420,443),fill='#6aa32a')
d.rounded_rectangle((112,120,207,258),radius=47,outline='#f5d789',width=20)
d.rounded_rectangle((305,120,400,258),radius=47,outline='#f5d789',width=20)
d.polygon([(153,103),(359,103),(345,237),(321,277),(284,300),(279,354),(335,372),(341,399),(171,399),(177,372),(233,354),(228,300),(191,277),(167,237)],fill='#f2cd71')
d.polygon([(171,122),(255,122),(255,284),(214,270),(186,235)],fill='#ffe8a3')
d.line((158,104,353,104),fill='#fff4ca',width=12)
d.polygon([(256,157),(269,184),(299,188),(277,209),(282,240),(256,225),(230,240),(235,209),(213,188),(243,184)],fill='#c3973f')
d.rounded_rectangle((186,373,326,386),radius=5,fill='#ffebb0')
out=root/'build';out.mkdir(exist_ok=True)
im.save(out/'icon.png')
im.save(out/'icon.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
