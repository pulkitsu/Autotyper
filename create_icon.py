from PIL import Image, ImageDraw, ImageFont

def create_icon():
    img = Image.new("RGBA", (64, 64), color=(24, 95, 165, 255))
    draw = ImageDraw.Draw(img)

    try:
        font = ImageFont.truetype("arialbd.ttf", 28)
    except:
        font = ImageFont.load_default()

    draw.text((12, 16), "AT", fill=(255, 255, 255, 255), font=font)

    img.save("autotyper.ico", format="ICO", sizes=[(16,16), (32,32), (48,48), (64,64)])
    print("autotyper.ico created.")

if __name__ == "__main__":
    create_icon()